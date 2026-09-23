import pytest

from ml_core.pending_actions import PendingAction


@pytest.mark.parametrize(
    "message",
    [
        "да, добавь.",
        "ДА, ДОБАВИТЬ",
        "да, добавить!",
        "Да, Подтверждаю.",
        "  Да, добавь!  ",
    ],
)
def test_confirm_returns_action_for_exact_frontend_confirmation(message: str) -> None:
    gate = PendingAction()
    action = {"action": "add_to_cart", "sku": "A-16", "qty": 2}

    gate.propose("session-1", action)
    gate.record_user_message("session-1", message)

    assert gate.confirm("session-1") == action
    # Confirmation consumes state, so a repeat cannot run the action twice.
    assert gate.confirm("session-1") is None


def test_non_confirmation_clears_pending_action() -> None:
    gate = PendingAction()
    gate.propose("session-2", {"action": "add_to_cart", "sku": "A-16", "qty": 1})
    gate.record_user_message("session-2", "Нет, мне нужен другой товар")

    assert gate.confirm("session-2") is None
    assert gate.confirm("session-2") is None


@pytest.mark.parametrize("message", ["yes", "да", "ДА!", "да добавь", "подтверждаю", "да, добавьте", "да, добавь!!", "да, добавь?"])
def test_non_frontend_confirmation_phrase_is_rejected(message: str) -> None:
    gate = PendingAction()
    gate.propose("session-3", {"action": "add_to_cart", "sku": "A-16", "qty": 1})
    gate.record_user_message("session-3", message)

    assert gate.confirm("session-3") is None
