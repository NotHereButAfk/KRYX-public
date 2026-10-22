// Room-scoped chat: the server owns names and rate limits; clients only supply text.
export function relayChat(room, conn, message, now = Date.now()) {
  const player = room.players.get(conn.id);
  if (!player || typeof message.text !== 'string' || message.text.length > 1000) return false;
  if (now - (conn.lastChatAt ?? -Infinity) < 2000) return false;
  const text = message.text.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '').trim().slice(0, 200);
  if (!text) return false;
  conn.lastChatAt = now;
  const packet = {t:'chat', name:player.name, text};
  for (const peer of room.players.values()) if (!peer.isBot) peer.send(packet);
  return true;
}
