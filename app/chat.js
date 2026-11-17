// Team group chat: everyone on the team, live updates.
import * as api from "./api.js";
import {
  html, useState, useEffect, useRef,
  S, setS, useStore, act, toast, isBoss, person, fmtDate, fmtTime, firstName, loadMessages, today,
  I, Avatar, Confirm, Empty,
} from "./lib.js";

export function ChatPage() {
  const s = useStore();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [del, setDel] = useState(null);
  const end = useRef();
  const box = useRef();
  const count = (s.messages || []).length;

  // Mark as read while open
  useEffect(() => {
    const last = (s.messages || []).at(-1)?.created_at || new Date().toISOString();
    if (last > (S.seenChatAt || "")) {
      try { localStorage.setItem("seenChatAt:" + S.me.id, last); } catch (_) { /* ignore */ }
      setS({ seenChatAt: last });
    }
  }, [count]);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [count]);
  useEffect(() => { loadMessages(); }, []);

  async function send(e) {
    e?.preventDefault();
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      await api.insert("messages", { user_id: s.me.id, body: body.slice(0, 2000) });
      setText("");
      await loadMessages();
    } catch (err) { toast(/relation|does not exist|schema cache/i.test(err.message || "") ? "Chat isn't set up yet. Run the database update." : err.message, "error"); }
    setSending(false);
  }

  let lastDay = "", lastUser = "", lastTs = 0;
  return html`<main class="chat">
    <div class="chat-head"><h1>Team chat</h1><span class="small muted">${s.profiles.filter((p) => p.status === "active").length} people</span></div>
    <div class="chat-list" ref=${box}>
      ${!s.chatReady ? html`<${Empty} icon=${I.chat} title="Chat isn't set up yet" text="A boss needs to run the latest database update in Supabase." />`
        : !count ? html`<${Empty} icon=${I.chat} title="No messages yet" text="Say hi to the team. Everyone with an account can see this chat." />`
        : s.messages.map((m) => {
          const day = new Date(m.created_at).toLocaleDateString("en-CA");
          const showDay = day !== lastDay;
          const t = new Date(m.created_at).getTime();
          const grouped = !showDay && lastUser === m.user_id && t - lastTs < 5 * 60 * 1000;
          lastDay = day; lastUser = m.user_id; lastTs = t;
          const mine = m.user_id === s.me.id;
          const canDel = mine || isBoss();
          return html`<div key=${m.id}>
            ${showDay && html`<div class="chat-day">${day === today() ? "Today" : fmtDate(day, { weekday: "long", month: "short", day: "numeric" })}</div>`}
            <div class="msg ${mine ? "mine" : ""} ${grouped ? "grouped" : ""}">
              ${!mine && html`<span class="msg-av">${!grouped && html`<${Avatar} id=${m.user_id} size=${32} />`}</span>`}
              <div class="msg-col">
                ${!mine && !grouped && html`<span class="msg-name">${person(m.user_id)?.full_name || "Former member"}</span>`}
                <button class="bubble" onClick=${() => canDel && setDel(m)} title=${fmtTime(m.created_at)}>${m.body}<span class="msg-time">${fmtTime(m.created_at)}</span></button>
              </div>
            </div>
          </div>`;
        })}
      <div ref=${end}></div>
    </div>
    <form class="chat-compose" onSubmit=${send}>
      <textarea rows="1" placeholder="Message the team…" value=${text} maxlength="2000"
        onInput=${(e) => { setText(e.target.value); e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 140) + "px"; }}
        onKeyDown=${(e) => { if (e.key === "Enter" && !e.shiftKey && !("ontouchstart" in window)) { e.preventDefault(); send(); } }}></textarea>
      <button class="btn" disabled=${!text.trim() || sending} aria-label="Send">${I.send}</button>
    </form>
    ${del && html`<${Confirm} title="Delete this message?" text=${`“${del.body.slice(0, 80)}${del.body.length > 80 ? "…" : ""}” will be removed for everyone.`}
      onClose=${() => setDel(null)} onOk=${async () => { await act(() => api.remove("messages", { id: del.id }), "Message deleted"); await loadMessages(); }} />`}
  </main>`;
}
