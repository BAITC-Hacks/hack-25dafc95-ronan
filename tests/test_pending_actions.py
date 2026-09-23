from ml_core.pending_actions import PendingAction


def test_confirm_returns_action_only_after_explicit_user_confirmation() -> None:
    gate = PendingAction()
    action = {"action": "add_to_cart", "sku": "A-16", "qty": 2}

    gate.propose("session-1", action)
    gate.record_user_message("session-1", "Да, добавьте")

    assert gate.confirm("session-1") == action
    # Confirmation consumes state, so a repeat cannot run the action twice.
    assert gate.confirm("session-1") is None


def test_non_confirmation_clears_pending_action() -> None:
    gate = PendingAction()
    gate.propose("session-2", {"action": "add_to_cart", "sku": "A-16", "qty": 1})
    gate.record_user_message("session-2", "Нет, мне нужен другой товар")

    assert gate.confirm("session-2") is None
    assert gate.confirm("session-2") is None
