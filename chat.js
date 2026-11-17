"use strict";

module.exports = async function chatApi(db, fail) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS profiles(uid INTEGER PRIMARY KEY REFERENCES users(id), handle TEXT UNIQUE COLLATE NOCASE, bio TEXT NOT NULL DEFAULT '', mood TEXT NOT NULL DEFAULT '', games TEXT NOT NULL DEFAULT '', image TEXT);
    CREATE TABLE IF NOT EXISTS friends(a INTEGER REFERENCES users(id), b INTEGER REFERENCES users(id), sender INTEGER NOT NULL, accepted INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(a,b));
    CREATE TABLE IF NOT EXISTS rooms(id INTEGER PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, owner INTEGER REFERENCES users(id), history INTEGER NOT NULL DEFAULT 0, image TEXT, dm_key TEXT UNIQUE);
    CREATE TABLE IF NOT EXISTS members(room INTEGER REFERENCES rooms(id), uid INTEGER REFERENCES users(id), role TEXT NOT NULL DEFAULT 'member', floor INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(room,uid));
    CREATE TABLE IF NOT EXISTS invites(room INTEGER REFERENCES rooms(id), uid INTEGER REFERENCES users(id), PRIMARY KEY(room,uid));
    CREATE TABLE IF NOT EXISTS bans(room INTEGER REFERENCES rooms(id), uid INTEGER REFERENCES users(id), PRIMARY KEY(room,uid));
    CREATE TABLE IF NOT EXISTS channels(id INTEGER PRIMARY KEY, room INTEGER NOT NULL REFERENCES rooms(id), title TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS posts(id INTEGER PRIMARY KEY, channel INTEGER REFERENCES channels(id), uid INTEGER REFERENCES users(id), body TEXT NOT NULL, image TEXT, created TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS posts_channel_id ON posts(channel,id);
  `);
  const { get, all, run } = db;
  const id = value => {
    if (!Number.isSafeInteger(value) || value < 1) fail(400, "Invalid ID.");
    return value;
  };
  const field = (value, limit, min = 0) => {
    const str = typeof value === "string" ? value.trim() : "";
    if (str.length < min || str.length > limit) fail(400, "Check the length of your input.");
    return str;
  };
  const profile = person => get(`SELECT u.id,u.name,coalesce(p.handle,'user_'||u.id) handle,
      coalesce(p.bio,'') bio,coalesce(p.mood,'') mood,coalesce(p.games,'') games,p.image
      FROM users u LEFT JOIN profiles p ON p.uid=u.id WHERE u.id=?`, person);
  const room = async key => await get("SELECT * FROM rooms WHERE id=?", id(key)) || fail(404, "Chat not found.");
  const membership = (key, user) => get("SELECT * FROM members WHERE room=? AND uid=?", key, user);
  const requireMember = async (key, user) => await membership(key, user) || fail(403, "Join this chat first.");
  const requireManager = async (key, user) => {
    if ((await requireMember(key,user)).role === "member") fail(403, "You don’t manage this chat.");
  };
  const pair = (a,b) => [Math.min(a,b), Math.max(a,b)];
  const friendship = (a,b) => get("SELECT * FROM friends WHERE a=? AND b=?", ...pair(a,b));
  const accepted = async (a,b) => (await friendship(a,b))?.accepted === 1;
  const addMember = async (r, uid, role = "member") => {
    if (await membership(r.id,uid)) return;
    const floor = r.kind === "group" && !r.history ? (await get("SELECT coalesce(max(id),0) n FROM posts")).n : 0;
    await run("INSERT INTO members VALUES(?,?,?,?)", r.id,uid,role,floor);
  };
  const newRoom = async (kind,title,owner,key = null) => {
    const r = await get("INSERT INTO rooms(kind,title,owner,dm_key) VALUES(?,?,?,?) RETURNING *",kind,title,owner,key);
    await run("INSERT INTO channels(room,title) VALUES(?,'General')", r.id);
    await addMember(r,owner,"owner");
    return r;
  };
  function image(value, limit = 350000) {
    if (value == null) return null;
    if (typeof value !== "string" || value.length > limit) fail(400, "Image is too large.");
    const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
    if (!match) fail(400, "Choose a PNG, JPEG, or WebP image.");
    const bytes = Buffer.from(match[2],"base64");
    const png = bytes.subarray(0,8).equals(Buffer.from("89504e470d0a1a0a","hex"));
    const jpeg = bytes.subarray(0,3).equals(Buffer.from("ffd8ff","hex"));
    const webp = bytes.toString("ascii",0,4)==="RIFF" && bytes.toString("ascii",8,12)==="WEBP";
    if (!({png,jpeg,webp})[match[1]]) fail(400, "Image format doesn’t match its contents.");
    return value;
  }

  const localGifs = new Set(require("./public/gifs.json").map(gif => gif.id));
  function gif(value) {
    if (value == null) return null;
    if (typeof value === "string") {
      if (value.startsWith("local:") && localGifs.has(value.slice(6))) return value;
      if (/^giphy:[a-zA-Z0-9]{1,64}$/.test(value)) return value;
    }
    fail(400, "Choose a GIF from the picker.");
  }

  async function snapshot(uid) {
    const chats = await all("SELECT r.*,m.role FROM rooms r JOIN members m ON m.room=r.id WHERE m.uid=? ORDER BY r.id",uid);
    for (const r of chats) {
      r.channels = await all("SELECT id,title FROM channels WHERE room=? AND active=1 ORDER BY id",r.id);
      if (r.kind === "dm") {
        const peer = await get("SELECT uid FROM members WHERE room=? AND uid<>?",r.id,uid);
        r.peer = await profile(peer.uid);
        r.title = r.peer.name;
      }
    }
    const friends = await all("SELECT * FROM friends WHERE a=? OR b=?",uid,uid);
    const friendships = await Promise.all(friends.map(async f => ({
      person: await profile(f.a === uid ? f.b : f.a), accepted: Boolean(f.accepted), incoming: f.sender !== uid,
    })));
    const recent = await all(`SELECT r.id AS room,p.id,p.channel,substr(p.body,1,120) AS body,CASE WHEN p.image LIKE 'local:%' OR p.image LIKE 'giphy:%' THEN 'gif'
        WHEN p.image IS NOT NULL THEN 'image' END AS attachment
      FROM members m JOIN rooms r ON r.id=m.room
      JOIN posts p ON p.id=(SELECT max(last.id) FROM channels c JOIN posts last ON last.channel=c.id
        WHERE c.room=r.id AND c.active=1 AND last.id>m.floor)
      WHERE m.uid=? ORDER BY p.id DESC LIMIT 5`,uid);
    return { me:await profile(uid), chats, friendships, recent,
      servers: await all(`SELECT r.id,r.title,r.image FROM rooms r WHERE r.kind='server'
        AND NOT EXISTS (SELECT 1 FROM bans b WHERE b.room=r.id AND b.uid=?)
        AND NOT EXISTS (SELECT 1 FROM members m WHERE m.room=r.id AND m.uid=?) ORDER BY r.title`,uid,uid),
      invites:await all("SELECT r.id,r.title FROM rooms r JOIN invites i ON i.room=r.id WHERE i.uid=?",uid) };
  }

  const callApi = require("./calls")({ room, requireMember, profile, fail,
    roomsFor: uid => all(`SELECT r.id,r.title,r.kind FROM rooms r JOIN members m ON m.room=r.id
      WHERE m.uid=? AND r.kind IN ('dm','group')`,uid) });

  return async function dispatch(route, uid, d, query) {
    if (route === "calls" || ["call-join","call-leave","call-poll","call-signal"].includes(route)) {
      return callApi(route,uid,d);
    }
    if (route === "state") return snapshot(uid);
    if (route === "view") {
      const r = await room(Number(query.get("room")));
      const m = await requireMember(r.id,uid);
      const channel = Number(query.get("channel"));
      const after = query.get("after");
      const cursor = Number(after);
      if (!Number.isSafeInteger(cursor) || cursor < 0) fail(400, "Invalid message position.");
      if (!await get("SELECT 1 FROM channels WHERE id=? AND room=? AND active=1",channel,r.id)) fail(404,"Channel not found.");
      const base = "SELECT id,uid,body,image,created FROM posts WHERE channel=? AND id>?";
      const posts = after === null
        ? (await all(base+" ORDER BY id DESC LIMIT 100",channel,m.floor)).reverse()
        : await all(base+" ORDER BY id LIMIT 100",channel,Math.max(m.floor,cursor));
      const members = await all("SELECT uid,role FROM members WHERE room=? ORDER BY role,uid",r.id);
      const banned = m.role !== "member" && r.kind === "server"
        ? await all("SELECT uid FROM bans WHERE room=?",r.id) : [];
      return {
        posts,
        authors: await Promise.all([...new Set(posts.map(post => post.uid))].map(profile)),
        members: await Promise.all(members.map(async person => ({...await profile(person.uid),role:person.role}))),
        banned: await Promise.all(banned.map(person => profile(person.uid))),
      };
    }
    if (route === "profile") {
      const handle = field(d.handle,25,1).replace(/^@/,"");
      const bio = field(d.bio,180), mood = field(d.mood,40), games = field(d.games,100);
      const photo = image(d.image);
      if (!/^[a-z0-9_]{1,24}$/i.test(handle) || (/^user_\d+$/i.test(handle) && handle !== "user_"+uid)) fail(400,"Use letters, numbers, or underscores for your username.");
      if (await get("SELECT 1 FROM profiles WHERE handle=? AND uid<>?",handle,uid)) fail(409,"That username is taken.");
      await run(`INSERT INTO profiles VALUES(?,?,?,?,?,?) ON CONFLICT(uid) DO UPDATE SET
        handle=excluded.handle,bio=excluded.bio,mood=excluded.mood,games=excluded.games,image=excluded.image`, uid,handle,bio,mood,games,photo);
      return profile(uid);
    }
    if (route === "friend") {
      const handle = field(d.handle,25,1).replace(/^@/,"");
      const other = /^user_\d+$/i.test(handle)
        ? await get("SELECT id uid FROM users WHERE 'user_'||id=? AND id NOT IN (SELECT uid FROM profiles WHERE handle IS NOT NULL)",handle.toLowerCase())
        : await get("SELECT uid FROM profiles WHERE handle=?",handle);
      if (!other || other.uid === uid) fail(404,"No other user has that username.");
      const [a,b] = pair(uid,other.uid);
      if (await friendship(uid,other.uid)) fail(409,"A friend request or friendship already exists.");
      await run("INSERT INTO friends(a,b,sender) VALUES(?,?,?)",a,b,uid);
      return {};
    }
    if (route === "friend-response") {
      const other = id(d.user);
      const f = await friendship(uid,other);
      if (!f || f.accepted || f.sender === uid) fail(404,"No pending request.");
      const [a,b] = pair(uid,other);
      if (d.accept === true) await run("UPDATE friends SET accepted=1 WHERE a=? AND b=?",a,b);
      else await run("DELETE FROM friends WHERE a=? AND b=?",a,b);
      return {};
    }
    if (route === "dm") {
      const other = id(d.user);
      if (!await accepted(uid,other)) fail(403,"Accept a friend request before messaging.");
      const key = pair(uid,other).join(":");
      const r = await get("SELECT * FROM rooms WHERE dm_key=?",key) || await newRoom("dm","",uid,key);
      await addMember(r,other);
      return { id:r.id };
    }
    if (route === "create") {
      if (!["group","server"].includes(d.kind)) fail(400,"Choose a group or server.");
      const title = field(d.title,48,1);
      return {id:(await newRoom(d.kind,title,uid)).id};
    }

    const r = await room(d.room);
    if (route === "join") {
      if (r.kind !== "server" && !await get("SELECT 1 FROM invites WHERE room=? AND uid=?",r.id,uid)) fail(403,"This group requires an invite.");
      if (await get("SELECT 1 FROM bans WHERE room=? AND uid=?",r.id,uid)) fail(403,"You are banned from this server.");
      await addMember(r,uid);
      await run("DELETE FROM invites WHERE room=? AND uid=?",r.id,uid);
      return { id:r.id };
    }
    if (route === "decline-invite") {
      await run("DELETE FROM invites WHERE room=? AND uid=?",r.id,uid);
      return {};
    }
    await requireMember(r.id,uid);
    if (route === "group-add") {
      const other = id(d.user);
      if (r.kind !== "group" || !await accepted(uid,other)) fail(403,"You can add your accepted friends to private groups.");
      if (d.invite === true) {
        if (!await membership(r.id,other)) await run("INSERT OR IGNORE INTO invites VALUES(?,?)",r.id,other);
      } else {
        await addMember(r,other);
        await run("DELETE FROM invites WHERE room=? AND uid=?",r.id,other);
      }
      return {};
    }
    if (route === "post") {
      const channel = id(d.channel);
      if (!await get("SELECT 1 FROM channels WHERE room=? AND id=? AND active=1",r.id,channel)) fail(404,"Channel not found.");
      const body = field(d.body,2000);
      const photo = image(d.image,800000);
      const reaction = gif(d.gif);
      if (photo && reaction) fail(400,"Send one attachment per message.");
      const attachment = photo || reaction;
      if (!body && !attachment) fail(400,"Write a message or attach an image.");
      return await get("INSERT INTO posts(channel,uid,body,image,created) VALUES(?,?,?,?,?) RETURNING id",channel,uid,body,attachment,new Date().toISOString());
    }

    await requireManager(r.id,uid);
    if (route === "group-history" && r.kind === "group") {
      await run("UPDATE rooms SET history=? WHERE id=?",d.enabled === true ? 1 : 0,r.id);
      return {};
    }
    if (route === "logo" && r.kind !== "dm") {
      await run("UPDATE rooms SET image=? WHERE id=?",image(d.image),r.id);
      return {};
    }
    if (route === "channel" && r.kind === "server") {
      const title = field(d.title,36,1);
      return await get("INSERT INTO channels(room,title) VALUES(?,?) RETURNING id",r.id,title);
    }
    if (["rename-channel","remove-channel"].includes(route) && r.kind === "server") {
      const channel = id(d.channel);
      if (route === "rename-channel") await run("UPDATE channels SET title=? WHERE room=? AND id=? AND active=1",field(d.title,36,1),r.id,channel);
      else {
        if ((await get("SELECT count(*) total FROM channels WHERE room=? AND active=1",r.id)).total <= 1) fail(400,"Keep at least one channel.");
        await run("UPDATE channels SET active=0 WHERE room=? AND id=?",r.id,channel);
      }
      return {};
    }
    if (route === "role" && r.owner === uid && r.kind !== "dm") {
      const other = id(d.user);
      if (other === uid) fail(400,"The owner’s role is fixed.");
      await requireMember(r.id,other);
      await run("UPDATE members SET role=? WHERE room=? AND uid=?",d.enabled === true ? "manager" : "member",r.id,other);
      return {};
    }
    if (["kick","ban","unban"].includes(route) && r.kind === "server") {
      const other = id(d.user);
      if (route === "unban") {
        await run("DELETE FROM bans WHERE room=? AND uid=?",r.id,other);
        return {};
      }
      const member = await requireMember(r.id,other);
      if (other === uid || member.role === "owner" || (member.role === "manager" && r.owner !== uid)) fail(403,"You can’t remove this member.");
      if (route === "ban") await run("INSERT OR IGNORE INTO bans VALUES(?,?)",r.id,other);
      await run("DELETE FROM members WHERE room=? AND uid=?",r.id,other);
      return {};
    }
    fail(404,"Action not found.");
  };
};
