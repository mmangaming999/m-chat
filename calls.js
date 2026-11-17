"use strict";

const { randomUUID } = require("node:crypto");

module.exports = function createCalls({ room, requireMember, profile, roomsFor, fail }) {
  const calls = new Map();
  const timeout = 16_000;
  const maxParticipants = 8;

  function remove(call, uid) {
    call.participants.delete(uid);
    if (!call.participants.size) calls.delete(call.room);
  }

  function sweep() {
    const now = Date.now();
    for (const call of calls.values()) {
      for (const [uid, participant] of call.participants) {
        if (now - participant.lastSeen > timeout) remove(call, uid);
      }
    }
  }
  setInterval(sweep, 5000).unref();

  function describe(call, title, uid) {
    const caller = call.participants.get(call.caller) ?? call.participants.values().next().value;
    return { id: call.id, room: call.room, title, caller: caller.name, joined: call.participants.has(uid) };
  }

  return async function callApi(route, uid, data) {
    if (route === "calls") {
      const rooms = await roomsFor(uid);
      sweep();
      return rooms.flatMap(r => {
        const call = calls.get(r.id);
        return call ? [describe(call, r.kind === "dm" ? call.participants.get(
          [...call.participants.keys()].find(id => id !== uid)
        )?.name ?? "Direct message" : r.title, uid)] : [];
      });
    }

    const chat = await room(data.room);
    await requireMember(chat.id, uid);
    if (chat.kind === "server") fail(403, "Calls are available in direct messages and private groups.");

    if (route === "call-join") {
      const person = await profile(uid);
      sweep();
      let call = calls.get(chat.id);
      const previous = call?.participants.get(uid);
      if (previous) {
        if (previous.client !== data.client) fail(409, "This account is already in the call in another tab.");
        previous.lastSeen = Date.now();
        return { id: call.id, key: previous.key, peer: previous.peer };
      }
      if (data.call && call?.id !== data.call) fail(409, "This call has ended.");
      if (typeof data.client !== "string" || !/^[a-f0-9-]{36}$/.test(data.client)) fail(400, "Invalid call client.");
      if (!call) {
        call = { id: randomUUID(), room: chat.id, caller: uid, participants: new Map(), sequence: 0 };
        calls.set(chat.id, call);
      }
      if (call.participants.size >= maxParticipants) fail(409, "This call is full.");
      const participant = { uid, name: person.name, image: person.image, key: randomUUID(),
        peer: randomUUID(), client: data.client, lastSeen: Date.now(), muted: false, sharing: false, camera: false, inbox: [] };
      call.participants.set(uid, participant);
      return { id: call.id, key: participant.key, peer: participant.peer };
    }

    sweep();
    const call = calls.get(chat.id);
    const self = call?.participants.get(uid);
    if (!self || self.key !== data.key || call.id !== data.call) fail(410, "You’re no longer in this call.");
    self.lastSeen = Date.now();

    if (route === "call-leave") {
      remove(call, uid);
      return {};
    }
    if (route === "call-poll") {
      const ack = data.ack;
      if (!Number.isSafeInteger(ack) || ack < 0 || ack > call.sequence) fail(400, "Invalid call cursor.");
      self.muted = data.muted === true;
      self.sharing = data.sharing === true;
      self.camera = data.camera === true;
      self.inbox = self.inbox.filter(message => message.sequence > ack);
      return {
        people: [...call.participants.values()].map(({uid,name,image,peer,muted,sharing,camera}) => ({uid,name,image,peer,muted,sharing,camera})),
        signals: self.inbox,
      };
    }
    if (route === "call-signal") {
      const target = [...call.participants.values()].find(person => person.peer === data.to);
      if (!target || target === self) fail(409, "That participant left the call.");
      if (!["offer", "answer"].includes(data.type) || typeof data.sdp !== "string" ||
          !data.sdp.startsWith("v=0") || data.sdp.length > 32_000) fail(400, "Invalid call signal.");
      if (target.inbox.length >= 24) fail(429, "Call signaling queue is full.");
      target.inbox.push({sequence: ++call.sequence, from: self.peer, type: data.type, sdp: data.sdp});
      return {};
    }
    fail(404, "Call action not found.");
  };
};
