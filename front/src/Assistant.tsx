import {
  ArrowDown,
  ArrowRight,
  FileText,
  Package,
  Paperclip,
  RotateCcw,
  Send,
  ShoppingBag,
  Sparkles,
  Truck,
  X,
  Zap,
} from "lucide-react";
import "./assistant.css";
import { ProductCard } from "./components";
import type { AssistantController } from "./useAssistant";
const money = (n: number) => new Intl.NumberFormat("ru-KZ").format(n) + " ₸";
const maxMB =
  Number(import.meta.env.VITE_MAX_ATTACHMENT_MB) > 0
    ? Number(import.meta.env.VITE_MAX_ATTACHMENT_MB)
    : 10;
/** Standalone chat + cart view. State and service operations are injected by its controller. */
export function Assistant(controller: AssistantController) {
  const {
    isMobile,
    source,
    products,
    cart,
    initError,
    loading,
    mobileCart,
    setMobileCart,
    proposal,
    issue,
    uncertain,
    busy,
    busyRef,
    setBusy,
    messages,
    sending,
    text,
    setText,
    file,
    setFile,
    fileError,
    uploadState,
    atBottom,
    setAtBottom,
    scrollRef,
    bottomRef,
    inputRef,
    assistantRef,
    fileRef,
    demo,
    locked,
    propose,
    reconcile,
    confirm,
    cancel,
    send,
    selectFile,
    switchMode,
    close,
    handleKeys,
    cartContent,
  } = controller;
  return (
    <section
      className={`ekt-assistant assistant-shell ${mobileCart ? "show-cart" : ""}`}
      ref={assistantRef}
      onKeyDown={handleKeys}
      role={isMobile ? "dialog" : undefined}
      aria-modal={isMobile || undefined}
      aria-label="Помощник и корзина"
    >
      <div className="chat-column">
        <header className="chat-header">
          <div className="assistant-avatar">
            <Sparkles size={21} />
          </div>
          <div>
            <h2>
              ЭКТ Ассистент <span>{demo ? "ДЕМО" : "API"}</span>
            </h2>
            <p>
              <i />
              {demo
                ? "Подготовленные ответы · без ИИ-модели"
                : "Сервисы команды"}
            </p>
          </div>
          <button
            className="mobile-cart-button icon-button"
            aria-label="Открыть панель корзины"
            onClick={() => setMobileCart(true)}
          >
            <ShoppingBag size={20} />
            <b>{cart.lines.length}</b>
          </button>
          <button
            className="icon-button close-chat"
            aria-label="Закрыть помощника"
            onClick={close}
          >
            <X size={20} />
          </button>
        </header>
        <div
          className="chat-scroll"
          ref={scrollRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            const near = el.scrollHeight - el.scrollTop - el.clientHeight < 90;
            bottomRef.current = near;
            setAtBottom(near);
          }}
        >
          <div className="conversation-date">
            СЕГОДНЯ · {demo ? "ДЕМОСЕССИЯ" : "API-СЕССИЯ"}
          </div>
          <div className="welcome">
            <span className="message-avatar">
              <Sparkles size={16} />
            </span>
            <div>
              <h3>Здравствуйте! Что подберём?</h3>
              <p>
                Помогу разобраться в электротехнике:
                <br />
                найти товар, сравнить варианты и собрать корзину.
              </p>
              <p className="welcome-foot">
                Начните с вопроса или выберите подсказку ↓
              </p>
              <div className="suggestions">
                {[
                  "Кабель ВВГнг-LS 3×2,5",
                  "Аналог ВВГ 3×2,5",
                  "Условия доставки",
                  "Все товары",
                ].map((s, i) => (
                  <button
                    disabled={sending || locked || loading}
                    key={s}
                    onClick={() => send(s)}
                  >
                    {
                      [
                        <Zap size={15} />,
                        <RotateCcw size={15} />,
                        <Truck size={15} />,
                        <Package size={15} />,
                      ][i]
                    }
                    {s}
                    <ArrowRight size={14} />
                  </button>
                ))}
              </div>
            </div>
          </div>
          {loading && <p role="status">Загрузка источника данных…</p>}
          {initError && (
            <div className="error-box" role="alert">
              {initError}
              <button onClick={() => switchMode(source.mode)}>
                Повторить подключение
              </button>
            </div>
          )}
          {messages.map((m) => (
            <article key={m.id} className={`message ${m.role}`}>
              <div className="message-label">
                {m.role === "user" ? "Вы" : "ЭКТ Ассистент"}
              </div>
              <p>{m.text}</p>
              {m.result?.analog && (
                <div className="analog-box">
                  <strong>Почему этот аналог</strong>
                  <p>{m.result.analog.reason}</p>
                  <p>Совпадает: {m.result.analog.matches.join(" · ")}</p>
                  <p>Отличия: {m.result.analog.differences.join(" · ")}</p>
                </div>
              )}
              {m.result?.products?.length === 0 && (
                <span className="micro">
                  Нет результатов в подготовленных сценариях.
                </span>
              )}
              {m.result?.products?.map((p) => (
                <ProductCard
                  key={p.id}
                  product={p}
                  onPropose={propose}
                  disabled={locked}
                />
              ))}
              {m.retry && (
                <button
                  className="retry-button"
                  disabled={sending || locked}
                  onClick={() => send(m.retry!.text, m.id, m.retry!.file)}
                >
                  <RotateCcw size={14} /> Повторить запрос
                </button>
              )}
              {m.success && source.cartUrl && (
                <a className="success-link" href={source.cartUrl}>
                  Открыть актуальную корзину <ArrowRight size={15} />
                </a>
              )}
            </article>
          ))}
          {sending && (
            <div className="typing" role="status">
              <span />
              <span />
              <span /> {uploadState || "Готовим ответ…"}
            </div>
          )}
          {proposal && (
            <div
              className={`proposal ${proposal.status}`}
              role="region"
              aria-label="Подтверждение операции"
            >
              <span className="eyebrow">
                {proposal.status === "active"
                  ? "ТРЕБУЕТ ВАШЕГО СОГЛАСИЯ"
                  : proposal.status === "pending"
                    ? "ВЫПОЛНЯЕМ ОПЕРАЦИЮ"
                    : proposal.status === "done"
                      ? "ВЫПОЛНЕНО"
                      : proposal.status === "cancelled"
                        ? "ОТМЕНЕНО"
                        : "ПРЕДЛОЖЕНИЕ ЗАМЕНЕНО"}
              </span>
              <h3>
                {proposal.intent.kind === "remove"
                  ? "Удалить товар?"
                  : proposal.intent.kind === "set"
                    ? "Изменить количество?"
                    : "Добавить в корзину?"}
              </h3>
              <p>
                <b>{proposal.product.name}</b>
                <br />
                {proposal.product.sku} · {proposal.intent.warehouse}
              </p>
              <div className="quote-row">
                <span>Было → станет</span>
                <b>
                  {proposal.before} → {proposal.after} {proposal.product.unit}
                </b>
              </div>
              <div className="quote-row">
                <span>Цена за {proposal.product.unit}</span>
                <b>{money(proposal.price)}</b>
              </div>
              <div className="quote-row">
                <span>
                  {proposal.intent.kind === "add"
                    ? "Сумма добавления"
                    : "Сумма позиции после изменения"}
                </span>
                <b>
                  {money(
                    (proposal.intent.kind === "add"
                      ? proposal.intent.quantity
                      : proposal.after) * proposal.price,
                  )}
                </b>
              </div>
              <p className="micro">
                Остаток выбранного склада: {proposal.available}{" "}
                {proposal.product.unit}. Итог позиции:{" "}
                {money(proposal.after * proposal.price)}.
              </p>
              <div className="confirmation-actions">
                <button
                  className="primary"
                  disabled={proposal.status !== "active" || locked}
                  onClick={confirm}
                >
                  {busy
                    ? "Выполняется…"
                    : proposal.intent.kind === "add"
                      ? "Да, добавить"
                      : proposal.intent.kind === "remove"
                        ? "Да, удалить"
                        : "Да, изменить"}
                </button>
                <button
                  className="secondary"
                  disabled={proposal.status !== "active" || locked}
                  onClick={cancel}
                >
                  Отмена
                </button>
              </div>
            </div>
          )}
          {issue && (
            <div className="notice" role="alert">
              {issue}
              {uncertain && (
                <button
                  disabled={busy}
                  onClick={async () => {
                    if (!proposal || busyRef.current) return;
                    busyRef.current = true;
                    setBusy(true);
                    await reconcile(proposal.id);
                    busyRef.current = false;
                    setBusy(false);
                  }}
                >
                  Сверить корзину
                </button>
              )}
            </div>
          )}
        </div>
        {!atBottom && (
          <button
            className="new-messages"
            onClick={() => {
              scrollRef.current?.scrollTo({
                top: scrollRef.current.scrollHeight,
                behavior: "smooth",
              });
              bottomRef.current = true;
            }}
          >
            <ArrowDown size={14} /> К последним сообщениям
          </button>
        )}
        <div className="sr-only" role="status">
          {messages.filter((m) => m.role === "assistant").at(-1)?.text}
        </div>
        <div className="composer-area">
          {file && (
            <div className="attachment">
              <FileText size={17} />
              <span>
                {file.name} · {(file.size / 1024).toFixed(1)} КБ
              </span>
              <button
                className="icon-button"
                aria-label="Убрать вложение"
                onClick={() => setFile(undefined)}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {fileError && (
            <p role="alert" className="file-error">
              {fileError}
            </p>
          )}
          <form
            className="composer"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <input
              type="file"
              hidden
              ref={fileRef}
              accept=".xls,.xlsx,.doc,.docx,.pdf,.jpg,.jpeg"
              onChange={(e) => {
                selectFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              className="icon-button"
              aria-label="Прикрепить файл"
              title={`Excel, Word, PDF, JPEG — до ${maxMB} МБ`}
              disabled={sending || locked}
              onClick={() => fileRef.current?.click()}
            >
              <Paperclip size={21} />
            </button>
            <textarea
              ref={inputRef}
              aria-label="Сообщение помощнику"
              value={text}
              maxLength={4000}
              placeholder="Спросите о товаре или прикрепите спецификацию…"
              rows={1}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing &&
                  e.keyCode !== 229
                ) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            <button
              type="submit"
              className="send-button"
              aria-label="Отправить сообщение"
              disabled={sending || locked || loading || (!text.trim() && !file)}
            >
              <Send size={19} />
            </button>
          </form>
          <div className="composer-hint">
            <span>Enter — отправить · Shift + Enter — новая строка</span>
            <span>Файлы до {maxMB} МБ</span>
          </div>
          <p className="privacy-note">
            {demo
              ? "Демо не читает и не загружает файлы. Переписка не сохраняется."
              : "Загрузка доступна только при подключении сервиса команды."}
          </p>
        </div>
      </div>
      <aside className="cart-column" aria-label="Корзина">
        {cartContent}
      </aside>
    </section>
  );
}
