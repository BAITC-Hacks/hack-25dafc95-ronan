"""Local HTTP adapter for Node's bounded candidate ranking contract.

This service never loads an EKT catalog or receives cart/session state. Node owns
the candidate set and verifies every returned ID before using it.
"""

from __future__ import annotations

import json
import os
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from .catalog import _search_score
from .models import Product

_IDENTIFIER = re.compile(r"(?<!\w)(?:\d{4,}_?|[A-Za-z][A-Za-z0-9]*_[A-Za-z0-9_]+)(?!\w)")
_CURRENT = re.compile(r"(?<!\w)(\d+(?:[.,]\d+)?)\s*[аa](?!\w)", re.IGNORECASE)
_KINDS = tuple(re.compile(pattern, re.IGNORECASE) for pattern in (
    r"автомат[а-яё]*|(?<!\w)ав(?!\w)", r"реле", r"контактор[а-яё]*", r"кабел[а-яё]*", r"ламп[а-яё]*",
))
_MAX_BODY = 65536


def _eligible(message: str, name: str) -> bool:
    requested_kind = next((kind for kind in _KINDS if kind.search(message)), None)
    if requested_kind and not requested_kind.search(name):
        return False
    requested = {float(value.replace(",", ".")) for value in _CURRENT.findall(message)}
    if requested:
        known = {float(value.replace(",", ".")) for value in _CURRENT.findall(name)}
        if len(requested) != 1 or known != requested:
            return False
    return True


def parse_rank(payload: object) -> dict[str, object]:
    if not isinstance(payload, dict) or set(payload) != {"message", "candidates"}:
        raise ValueError("Expected message and candidates")
    message, candidates = payload["message"], payload["candidates"]
    if not isinstance(message, str) or not 1 <= len(message.strip()) <= 1000:
        raise ValueError("Invalid message")
    if not isinstance(candidates, list) or len(candidates) > 50:
        raise ValueError("Invalid candidates")
    match = _IDENTIFIER.search(message)
    query = (match.group() if match else message.strip()[:100])
    ranked: list[tuple[int, float]] = []
    seen: set[int] = set()
    for item in candidates:
        if not isinstance(item, dict) or set(item) != {"id", "name", "article"}:
            raise ValueError("Invalid candidate")
        identifier, name, article = item["id"], item["name"], item["article"]
        if (isinstance(identifier, bool) or not isinstance(identifier, int) or identifier <= 0
                or identifier in seen or not isinstance(name, str) or not isinstance(article, str)
                or len(name) > 1000 or len(article) > 100):
            raise ValueError("Invalid candidate")
        seen.add(identifier)
        if match:
            # Exact identifiers keep leading zeroes and underscores, and must not
            # degrade to approximate electrical matches.
            identifier_token = re.compile(r"(?<!\w)" + re.escape(query) + r"(?!\w)", re.IGNORECASE)
            if query.casefold() not in {str(identifier), article.casefold()} and not identifier_token.search(name):
                continue
        elif not _eligible(message, name):
            continue
        score = _search_score(query, Product(sku=str(identifier), name=f"{name} {article}"))
        if score >= 0.22:
            ranked.append((identifier, score))
    ranked.sort(key=lambda entry: (-entry[1], entry[0]))
    return {"query": query, "ranked_ids": [identifier for identifier, _ in ranked[:20]]}


class Handler(BaseHTTPRequestHandler):
    def do_POST(self) -> None:
        if self.path != "/v1/parse-rank":
            self.send_error(404)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > _MAX_BODY:
                raise ValueError("Invalid body length")
            result = parse_rank(json.loads(self.rfile.read(length)))
        except (ValueError, UnicodeDecodeError, json.JSONDecodeError):
            self.send_error(400)
            return
        body = json.dumps(result, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, _format: str, *_args: object) -> None:
        pass


def main() -> None:
    port = int(os.getenv("ML_CORE_PORT", "8100"))
    with ThreadingHTTPServer(("127.0.0.1", port), Handler) as server:
        print(f"ml_core listening on 127.0.0.1:{port}", flush=True)
        server.serve_forever()


if __name__ == "__main__":
    main()
