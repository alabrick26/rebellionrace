// XMLSocket framing: every message is terminated by a NUL byte, and a single WebSocket message from the
// proxy may carry several messages or only part of one. Decodes UTF-8 statefully so characters split
// across chunks survive.
export function makeFramer(onMessage, maxPending = 4096) {
  const dec = new TextDecoder();
  let pending = '';
  return (data) => {
    pending += typeof data === 'string' ? data : dec.decode(data, { stream: true });
    let i;
    while ((i = pending.indexOf('\0')) >= 0) {
      const msg = pending.slice(0, i);
      pending = pending.slice(i + 1);
      if (msg) onMessage(msg);
    }
    if (pending.length > maxPending) pending = ''; // refuse unterminated floods
  };
}

const enc = new TextEncoder();
/** Encode one outgoing message with its NUL terminator (sent as a binary frame). */
export const frame = (s) => enc.encode(`${s}\0`);
