// ElectroServer-3-style XML envelopes spoken by the game's com.utils.ElectroServer client class.
//   client -> server:  <XmlDoc><Action>..</Action><Parameters>..</Parameters></XmlDoc>
//   server -> client:  same envelope; anything NOT starting with "<" is a raw game message.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);
const UNESC = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };
const unesc = (s) => s.replace(/&(amp|lt|gt|quot|apos);/g, (m) => UNESC[m]);

/** Body of the first <name>..</name> inside text, or undefined. */
export function tag(text, name) {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(text);
  return m ? unesc(m[1]) : undefined;
}

export const esDoc = (action, params = '') =>
  `<XmlDoc><Action>${action}</Action><Parameters>${params}</Parameters></XmlDoc>`;

export const connectionAccepted = () =>
  esDoc('ConnectionResponse', '<Result>Accepted</Result><Version Major="3" Minor="2" Sub="0"></Version>');

export const loginAccepted = (name) =>
  esDoc('LoginResponse', `<Result>Accepted</Result><Username>${esc(name)}</Username><Variables></Variables>`);

export const loginDeclined = (reason) =>
  esDoc('LoginResponse', `<Result>Declined</Result><Reason>${esc(reason)}</Reason>`);

export const serverTimeXml = (ms) => esDoc('GetServerTime', `<ServerTime>${ms}</ServerTime>`);

/** Parse a client XmlDoc into { action, name, password, plugin, method, vars } or null. */
export function parseClientDoc(text) {
  const action = tag(text, 'Action');
  if (!action) return null;
  const params = tag(text, 'Parameters') ?? '';
  const vars = {};
  for (const m of params.matchAll(/<Variable>([\s\S]*?)<\/Variable>/g)) {
    const k = tag(m[1], 'Name') ?? tag(m[1], 'n');
    if (k !== undefined) vars[k] = tag(m[1], 'Value') ?? tag(m[1], 'Data') ?? '';
  }
  return {
    action,
    name: tag(params, 'Name') ?? tag(params, 'n'),
    password: tag(params, 'Password'),
    plugin: tag(params, 'Plugin'),
    method: tag(params, 'Method'),
    vars,
  };
}
