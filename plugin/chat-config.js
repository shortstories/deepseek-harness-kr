/**
 * Config defaults and validation for the character chat.
 *
 * A bad value is refused when the plugin activates, naming the exact field: a
 * broken baseUrl cannot be repaired at request time. Unknown keys are ignored
 * so a profile written for a newer version still boots.
 * @module deepseek-harness-kr/chat-config
 */

/**
 * Defaults. No endpoint or model is assumed: an empty baseUrl keeps the model
 * replies off, and the character falls back to its built-in rule-based lines.
 */
export const CHAT_DEFAULTS = {
  enabled: false,
  // 'api' posts to an OpenAI-compatible endpoint; 'session' borrows the route
  // of a live DSH session through the LLM service and needs no endpoint or key.
  source: 'api',
  openai: { baseUrl: '', model: '', apiKeyEnv: 'DSH_CHAT_API_KEY', timeoutMs: 20000, temperature: null },
  // Thinking is off by default: a one-line mutter or a short reply does not
  // need it, and it costs latency the character cannot afford.
  session: { reasoningEffort: 'off' },
  roles: { mutter: true, summary: true, chat: true },
  prompts: { mutter: '', summary: '', chat: '' },
}

/** Throw one error naming the config path, the expectation and the value. */
function fail(path, expected, value) {
  throw new Error('deepseek-harness-kr: config.chat.' + path + ' must be ' + expected + ', got ' + JSON.stringify(value ?? null))
}

/** Read an optional nested config section; null and arrays are refused. */
function section(source, key) {
  const value = source[key]
  if (value === undefined) return {}
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(key, 'an object', value)
  return value
}

function bool(source, key, path, fallback) {
  const value = source[key]
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') fail(path, 'a boolean', value)
  return value
}

/** Optional string that may be empty (a prompt override, a model id). */
function optionalText(source, key, path, fallback) {
  const value = source[key]
  const resolved = value === undefined ? fallback : value
  if (typeof resolved !== 'string') fail(path, 'a string', resolved)
  return resolved
}

/** Optional http(s) URL: '' means "not configured yet"; trailing slashes are dropped. */
function optionalUrl(source, key, path, fallback) {
  const trimmed = optionalText(source, key, path, fallback).trim()
  if (trimmed.length === 0) return ''
  let parsed
  try {
    parsed = new URL(trimmed)
  } catch {
    fail(path, 'an absolute http(s) URL', trimmed)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') fail(path, 'an http(s) URL', trimmed)
  return trimmed.replace(/\/+$/, '')
}

/** Credential reference names double as environment variable names. */
const CREDENTIAL_REF = /^[A-Za-z_][A-Za-z0-9_]*$/

/** Optional credential reference: '' opts out of auth, anything else is a POSIX identifier. */
function credentialName(source, key, path, fallback) {
  const trimmed = optionalText(source, key, path, fallback).trim()
  if (trimmed.length > 0 && !CREDENTIAL_REF.test(trimmed)) fail(path, 'empty or a name like DSH_CHAT_API_KEY', trimmed)
  return trimmed
}

function num(source, key, path, fallback, min, max, { integer = false } = {}) {
  const value = source[key]
  const resolved = value === undefined ? fallback : value
  if (typeof resolved !== 'number' || !Number.isFinite(resolved) || resolved < min || resolved > max
    || (integer && !Number.isInteger(resolved))) {
    fail(path, 'a number in [' + min + ', ' + max + ']', resolved)
  }
  return resolved
}

/** One of a fixed set of strings. */
function oneOf(source, key, path, allowed, fallback) {
  const value = source[key]
  const resolved = value === undefined ? fallback : value
  if (typeof resolved !== 'string' || !allowed.includes(resolved)) fail(path, 'one of ' + allowed.join(', '), resolved)
  return resolved
}

/** Optional temperature: null keeps the per-role default. */
function optionalTemperature(source, key, path, fallback) {
  const value = source[key]
  const resolved = value === undefined ? fallback : value
  if (resolved === null) return null
  return num({ [key]: resolved }, key, path, fallback, 0, 2)
}

/**
 * Validate and normalize the chat config.
 * @param raw - raw config from cordis.patch.yml, possibly undefined.
 * @returns the normalized config: every field present, unknown keys dropped.
 */
export function normalizeChat(raw) {
  const source = raw ?? {}
  if (typeof source !== 'object' || Array.isArray(source)) fail('config', 'an object', source)
  const openai = section(source, 'openai')
  const session = section(source, 'session')
  const roles = section(source, 'roles')
  const prompts = section(source, 'prompts')
  return {
    enabled: bool(source, 'enabled', 'enabled', CHAT_DEFAULTS.enabled),
    source: oneOf(source, 'source', 'source', ['api', 'session'], CHAT_DEFAULTS.source),
    openai: {
      baseUrl: optionalUrl(openai, 'baseUrl', 'openai.baseUrl', CHAT_DEFAULTS.openai.baseUrl),
      // '' leaves the field out of the request; the server's default applies.
      model: optionalText(openai, 'model', 'openai.model', CHAT_DEFAULTS.openai.model).trim(),
      // A credential reference (stored key first, then the same-named env var);
      // '' opts out of auth entirely (local/self-hosted servers without a key).
      apiKeyEnv: credentialName(openai, 'apiKeyEnv', 'openai.apiKeyEnv', CHAT_DEFAULTS.openai.apiKeyEnv),
      timeoutMs: num(openai, 'timeoutMs', 'openai.timeoutMs', CHAT_DEFAULTS.openai.timeoutMs, 1000, 600000, { integer: true }),
      temperature: optionalTemperature(openai, 'temperature', 'openai.temperature', CHAT_DEFAULTS.openai.temperature),
    },
    session: {
      // '' leaves the effort to the model's own default.
      reasoningEffort: optionalText(session, 'reasoningEffort', 'session.reasoningEffort', CHAT_DEFAULTS.session.reasoningEffort).trim(),
    },
    roles: {
      mutter: bool(roles, 'mutter', 'roles.mutter', CHAT_DEFAULTS.roles.mutter),
      summary: bool(roles, 'summary', 'roles.summary', CHAT_DEFAULTS.roles.summary),
      chat: bool(roles, 'chat', 'roles.chat', CHAT_DEFAULTS.roles.chat),
    },
    prompts: {
      mutter: optionalText(prompts, 'mutter', 'prompts.mutter', CHAT_DEFAULTS.prompts.mutter),
      summary: optionalText(prompts, 'summary', 'prompts.summary', CHAT_DEFAULTS.prompts.summary),
      chat: optionalText(prompts, 'chat', 'prompts.chat', CHAT_DEFAULTS.prompts.chat),
    },
  }
}
