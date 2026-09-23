"""Server-side confirmation gate for state-changing chat actions."""

from __future__ import annotations

import copy
import re
import threading
from dataclasses import dataclass
from typing import Any, Mapping

_TOKEN_RE = re.compile(r"[\w-]+", re.UNICODE)
_AFFIRMATIVE_PHRASES = {
    "yes",
    "y",
    "confirm",
    "confirmed",
    "i confirm",
    "да",
    "подтверждаю",
    "подтвердить",
    "подтверждено",
}
_NEGATIVE_TOKENS = {"no", "n", "not", "dont", "don't", "нет", "не", "отмена", "отменить"}


def _is_explicit_confirmation(message: str) -> bool:
    normalised = " ".join(_TOKEN_RE.findall(message.casefold()))
    tokens = set(normalised.split())
    if not normalised or tokens & _NEGATIVE_TOKENS:
        return False
    if normalised in _AFFIRMATIVE_PHRASES:
        return True
    # Allow a clear affirmative followed by the requested operation, e.g. "да, добавьте".
    return normalised.startswith(("yes ", "confirm ", "да ", "подтверждаю ", "подтвердить "))


@dataclass(slots=True)
class _Proposal:
    action: dict[str, Any]
    last_user_message: str | None = None


class PendingAction:
    """In-process server-side confirmation state keyed by session id.

    The backend records the *raw user message* with :meth:`record_user_message`.
    :meth:`confirm` returns the original proposed action only for an explicit
    affirmative and clears it after every confirmation attempt. The LLM never
    supplies an action to ``confirm`` and cannot bypass this gate.
    """

    def __init__(self) -> None:
        self._proposals: dict[str, _Proposal] = {}
        self._lock = threading.RLock()

    def propose(self, session_id: str, action: Mapping[str, Any]) -> None:
        """Store a proposed action for the session, replacing a prior proposal."""
        if not session_id:
            raise ValueError("session_id must not be empty")
        if not isinstance(action, Mapping) or not action:
            raise ValueError("action must be a non-empty mapping")
        # A deep copy prevents callers or model/tool payloads from mutating stored state later.
        with self._lock:
            self._proposals[session_id] = _Proposal(action=copy.deepcopy(dict(action)))

    def record_user_message(self, session_id: str, message: str) -> None:
        """Record the next raw user message for a pending session, if any."""
        with self._lock:
            proposal = self._proposals.get(session_id)
            if proposal is not None:
                proposal.last_user_message = message

    def confirm(self, session_id: str) -> dict[str, Any] | None:
        """Consume a proposal and return it only if its next message clearly confirms it."""
        with self._lock:
            proposal = self._proposals.pop(session_id, None)
        if proposal is None or proposal.last_user_message is None:
            return None
        if not _is_explicit_confirmation(proposal.last_user_message):
            return None
        return copy.deepcopy(proposal.action)
