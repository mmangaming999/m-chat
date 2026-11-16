"use strict";

function createVoiceCalls(root, api, roomFor, openRoom) {
  const get = selector => root.querySelector(selector);
  const startButton = get("[data-start-call]");
  const answerButton = get("[data-answer-call]");
  const incoming = get("[data-incoming-call]");
  const panel = get("[data-voice-call]");
  const dock = get("[data-call-dock]");
  const slot = get("[data-call-slot]");
  const tiles = get("[data-call-people]");
  const status = get("[data-voice-status]");
  const mute = get("[data-mute-call]");
  const camera = get("[data-camera-call]");
  const end = get("[data-end-call]");
  const enableAudio = get("[data-enable-call-audio]");
  const errorNotice = get("[data-call-error]");
  const dismissed = new Set();

  let room = "home";
  let session;
  let pending;
  let pendingCamera;
  let openCalls = [];
  let invitation;
  let audioContext;
  let pollTimer;
  let meterTimer;
  let nextRing = 0;
  let lifecycle = 0;
  let running = false;
  let noticeTimer;

  const screenShare = createScreenShare(root, () => session, showError);

  function showError(message) {
    errorNotice.textContent = message;
    errorNotice.hidden = false;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { errorNotice.hidden = true; }, 6000);
  }

  function unlockAudio() {
    try {
      if (!audioContext || audioContext.state === "closed") audioContext = new AudioContext();
      if (audioContext.state === "suspended") audioContext.resume().catch(() => {});
    } catch { /* Voice transport can still work without the meter or ringtone. */ }
  }

  function ring() {
    if (audioContext?.state !== "running") return;
    const at = audioContext.currentTime;
    for (const [offset,frequency] of [[0,540],[0.19,720]]) {
      const tone = audioContext.createOscillator();
      const volume = audioContext.createGain();
      const begin = at + offset;
      tone.frequency.value = frequency;
      volume.gain.setValueAtTime(.001, begin);
      volume.gain.exponentialRampToValueAtTime(.075, begin + .024);
      volume.gain.exponentialRampToValueAtTime(.001, begin + .15);
      tone.connect(volume).connect(audioContext.destination);
      tone.start(begin);
      tone.stop(begin + .16);
    }
  }

  function render() {
    const here = roomFor(room);
    const live = openCalls.find(call => String(call.room) === room);
    const inThisRoom = session && String(session.room) === room;
    const otherCall = session && !inThisRoom;
    const label = live ? "Join voice call" : "Start voice call";
    startButton.hidden = !here || here.kind === "server" || Boolean(inThisRoom);
    startButton.disabled = Boolean(pending || otherCall);
    startButton.setAttribute("aria-label",label);
    startButton.title = otherCall ? "You’re already in another call" : label;
    startButton.classList.toggle("call-join",Boolean(live));

    panel.hidden = !session;
    if (session) {
      const parent = inThisRoom ? slot : dock;
      if (panel.parentElement !== parent) parent.append(panel);
      get("[data-voice-title]").textContent = "Voice call · " + (roomFor(session.room)?.title ?? "Chat");
    }
    incoming.hidden = !invitation;
    answerButton.disabled = Boolean(pending);
    if (invitation) {
      get("[data-call-invitation]").textContent = invitation.caller + " is calling";
      get("[data-call-invitation-room]").textContent = roomFor(invitation.room)?.title ?? invitation.title;
    }
  }

  function send(state, action, data = {}) {
    return api(action, { room: state.room, call: state.id, key: state.key, ...data });
  }

  function makeTile(person, own) {
    const element = document.createElement("div");
    element.className = "call-person";
    const name = document.createElement("span");
    name.className = "call-person-name";
    const muted = get("[data-mic-off]").cloneNode(true);
    muted.removeAttribute("data-mic-off");
    muted.classList.add("call-person-mute");
    muted.setAttribute("hidden","");
    element.append(name,muted);
    const video = document.createElement("video");
    video.className = "call-webcam";
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    video.hidden = true;
    video.setAttribute("aria-label",own ? "Your camera" : person.name + "’s camera");
    if (own) video.classList.add("call-webcam-local");
    element.prepend(video);
    const tile = {element,name,muted,video};
    for (const event of ["loadeddata","playing","emptied"]) {
      video.addEventListener(event,() => updateCameraFrame(tile));
    }
    updateTile(tile,person,own);
    tiles.append(element);
    return tile;
  }

  function updateTile(tile, person, own) {
    if (tile.photo !== person.image || tile.personName !== person.name) {
      const image = document.createElement(person.image ? "img" : "span");
      if (person.image) {
        image.src = person.image;
        image.alt = "";
      } else {
        image.className = "call-initials";
        image.textContent = person.name.slice(0,2).toUpperCase();
      }
      tile.avatar?.remove();
      tile.element.prepend(image);
      tile.avatar = image;
      tile.photo = person.image;
      tile.personName = person.name;
      tile.name.textContent = own ? "You" : person.name;
      updateCameraFrame(tile);
    }
    tile.muted.toggleAttribute("hidden",!person.muted);
  }

  function cameraIsOn(state) {
    return Boolean(state?.webcam?.getVideoTracks()[0]?.readyState === "live");
  }

  function updateCameraFrame(tile) {
    const visible = Boolean(tile.video.srcObject && tile.video.readyState >= 2);
    tile.video.hidden = !visible;
    tile.avatar.hidden = visible;
    tile.element.toggleAttribute("data-camera-visible",visible);
  }

  function showCamera(tile, stream) {
    if (!tile || tile.video.srcObject === (stream ?? null)) return;
    tile.video.srcObject = stream ?? null;
    updateCameraFrame(tile);
    if (stream) tile.video.play().catch(() => {});
  }

  function updateCameraButton() {
    const on = cameraIsOn(session);
    const label = on ? "Turn camera off" : "Turn camera on";
    camera.disabled = Boolean(pendingCamera);
    camera.setAttribute("aria-pressed",String(on));
    camera.setAttribute("aria-label",label);
    camera.title = label;
    get("[data-camera-on]").toggleAttribute("hidden",!on);
    get("[data-camera-off]").toggleAttribute("hidden",on);
  }

  function attachCamera(state, peer) {
    if (!peer.camera) return;
    const sender = peer.camera.sender;
    peer.cameraUpdate = (peer.cameraUpdate ?? Promise.resolve()).then(async () => {
      if (state !== session || peer.pc.signalingState === "closed") return;
      const track = cameraIsOn(state) ? state.webcam.getVideoTracks()[0] : null;
      if (sender.track !== track) await sender.replaceTrack(track);
    }).catch(() => {
      if (state === session && cameraIsOn(state) && peer.pc.signalingState !== "closed") {
        showError("A participant couldn’t receive your camera.");
      }
    });
    return peer.cameraUpdate;
  }

  function stopCamera(state) {
    const stream = state?.webcam;
    if (!stream) return;
    state.webcam = undefined;
    for (const track of stream.getTracks()) track.stop();
    showCamera(state.tiles.get(state.peer),null);
    for (const peer of state.peers.values()) attachCamera(state,peer);
    updateCameraButton();
  }

  async function toggleCamera() {
    const state = session;
    if (!state || pendingCamera) return;
    if (cameraIsOn(state)) return stopCamera(state);
    if (!navigator.mediaDevices?.getUserMedia) {
      showError("Open m-chat on localhost or HTTPS to use your camera.");
      return;
    }
    const attempt = {};
    pendingCamera = attempt;
    updateCameraButton();
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video:{width:{ideal:1280,max:1280},height:{ideal:720,max:720},frameRate:{ideal:30,max:30}},
        audio:false,
      });
      if (session !== state || pendingCamera !== attempt) return;
      const track = stream.getVideoTracks()[0];
      if (!track || track.readyState !== "live") {
        showError("Your camera didn’t provide a video stream.");
        return;
      }
      const captured = stream;
      state.webcam = captured;
      stream = undefined;
      track.addEventListener("ended",() => {
        if (session === state && state.webcam === captured) stopCamera(state);
      },{once:true});
      showCamera(state.tiles.get(state.peer),captured);
      for (const peer of state.peers.values()) attachCamera(state,peer);
    } catch (error) {
      if (session !== state || pendingCamera !== attempt) return;
      const messages = {
        NotAllowedError:"Allow camera access in your browser to turn on video.",
        NotFoundError:"Connect a webcam to turn on video.",
        NotReadableError:"The camera couldn’t start. Check whether another app or window is using it.",
      };
      showError(messages[error.name] ?? "Couldn’t turn on the camera.");
    } finally {
      if (stream) for (const track of stream.getTracks()) track.stop();
      if (pendingCamera === attempt) pendingCamera = undefined;
      updateCameraButton();
    }
  }

  function watch(state, id, stream) {
    if (!audioContext || state.levels.has(id)) return;
    try {
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      state.levels.set(id,{source,analyser,samples:new Float32Array(analyser.fftSize),lastSound:0});
    } catch { /* The call can still run when the waveform is unavailable. */ }
  }

  function unwatch(state, id) {
    const meter = state.levels.get(id);
    if (!meter) return;
    meter.source.disconnect();
    meter.analyser.disconnect();
    state.levels.delete(id);
  }

  function drawLevels() {
    const state = session;
    if (!state) return;
    const now = performance.now();
    for (const [id,tile] of state.tiles) {
      const meter = state.levels.get(id);
      if (!meter || !tile.muted.hasAttribute("hidden") || audioContext?.state !== "running") {
        tile.element.removeAttribute("data-speaking");
        continue;
      }
      meter.analyser.getFloatTimeDomainData(meter.samples);
      let power = 0;
      for (const sample of meter.samples) power += sample * sample;
      if (Math.sqrt(power / meter.samples.length) > .02) meter.lastSound = now;
      tile.element.toggleAttribute("data-speaking", meter.lastSound > 0 && now - meter.lastSound < 260);
    }
  }

  function callStatus(state) {
    if (session !== state) return;
    const connections = [...state.peers.values()];
    const failure = connections.find(peer => peer.failure)?.failure;
    const stalled = connections.some(peer => peer.pc.connectionState === "failed" ||
      (peer.pc.connectionState !== "connected" && Date.now() - peer.started > 20000));
    status.textContent = !connections.length ? "Waiting for someone to join…" : failure ||
      (stalled ? "Connection failed. Hang up and rejoin." :
        connections.every(peer => peer.pc.connectionState === "connected") ? "Connected" : "Connecting…");
  }

  function gather(pc) {
    if (pc.iceGatheringState === "complete") return Promise.resolve();
    return new Promise(resolve => {
      function check() {
        if (pc.iceGatheringState === "complete" || pc.signalingState === "closed") finish();
      }
      function finish() {
        clearTimeout(timer);
        pc.removeEventListener("icegatheringstatechange",check);
        pc.removeEventListener("signalingstatechange",check);
        resolve();
      }
      const timer = setTimeout(finish,3000);
      pc.addEventListener("icegatheringstatechange",check);
      pc.addEventListener("signalingstatechange",check);
      check();
    });
  }

  function enqueue(state, peer, operation) {
    peer.queue = peer.queue.then(async () => {
      if (session === state && peer.pc.signalingState !== "closed") await operation(peer.pc);
    }).catch(error => {
      if (session !== state || peer.pc.signalingState === "closed" || error.status === 409) return;
      peer.failure = "Connection failed. Hang up and rejoin.";
      callStatus(state);
    });
  }

  async function advertise(state, peer, description) {
    await peer.pc.setLocalDescription(description);
    await gather(peer.pc);
    if (session !== state || peer.pc.signalingState === "closed") return;
    const {type,sdp} = peer.pc.localDescription;
    if (!/^a=candidate:/m.test(sdp)) {
      peer.failure = "This browser couldn’t find a direct route for voice.";
      callStatus(state);
      return;
    }
    await send(state,"call-signal",{to:peer.id,type,sdp});
  }

  function addPeer(state, person) {
    const pc = new RTCPeerConnection();
    const audio = document.createElement("audio");
    audio.autoplay = true;
    audio.hidden = true;
    panel.append(audio);
    for (const track of state.stream.getAudioTracks()) pc.addTrack(track,state.stream);
    const initiates = state.uid < person.uid;
    const screen = initiates ? pc.addTransceiver("video",{direction:"sendrecv"}) : undefined;
    const camera = initiates ? pc.addTransceiver("video",{direction:"sendrecv"}) : undefined;
    const peer = {id:person.peer,pc,audio,screen,camera,started:Date.now(),queue:Promise.resolve()};
    state.peers.set(person.peer,peer);
    screenShare.attachPeer(state,peer);
    attachCamera(state,peer);
    pc.addEventListener("track",event => {
      if (session !== state || !state.peers.has(peer.id)) return;
      if (event.track.kind !== "audio") return;
      const stream = event.streams[0] ?? new MediaStream([event.track]);
      audio.srcObject = stream;
      audio.play().catch(() => { if (session === state) enableAudio.hidden = false; });
      watch(state,peer.id,stream);
    });
    pc.addEventListener("connectionstatechange",() => {
      callStatus(state);
      if (pc.connectionState === "connected") {
        screenShare.attachPeer(state,peer);
        attachCamera(state,peer);
      }
    });
    if (initiates) enqueue(state,peer,async () => advertise(state,peer,await pc.createOffer()));
  }

  function removePeer(state, id) {
    const peer = state.peers.get(id);
    if (!peer) return;
    peer.pc.close();
    peer.audio.srcObject = null;
    peer.audio.remove();
    unwatch(state,id);
    state.peers.delete(id);
  }

  function setPeople(state, people) {
    const self = people.find(person => person.peer === state.peer);
    state.uid = self.uid;
    const remaining = new Set(people.map(person => person.peer));
    for (const [id,tile] of state.tiles) {
      if (remaining.has(id)) continue;
      showCamera(tile,null);
      tile.element.remove();
      state.tiles.delete(id);
      removePeer(state,id);
    }
    for (const person of people) {
      const id = person.peer;
      const own = id === state.peer;
      if (own) person.muted = state.muted;
      let tile = state.tiles.get(id);
      if (tile) updateTile(tile,person,own);
      else {
        tile = makeTile(person,own);
        state.tiles.set(id,tile);
      }
      if (!own && !state.peers.has(id)) addPeer(state,person);
      const stream = own ? state.webcam : person.camera ? state.peers.get(id)?.cameraStream : null;
      showCamera(tile,stream);
    }
    screenShare.updatePeople(state,people);
    callStatus(state);
  }

  async function pollSession(state) {
    const result = await send(state,"call-poll",{
      ack:state.ack,muted:state.muted,sharing:screenShare.isSharing(state),camera:cameraIsOn(state),
    });
    if (session !== state) return;
    setPeople(state,result.people);
    for (const {sequence,from,type,sdp} of result.signals) {
      state.ack = Math.max(state.ack,sequence);
      const peer = state.peers.get(from);
      if (!peer) continue;
      enqueue(state,peer,async pc => {
        await pc.setRemoteDescription({type,sdp});
        // Preserve the screen-share video line first so older clients can still
        // share a screen. The second video line carries the webcam.
        const videoLines = pc.getTransceivers().filter(item => item.receiver.track.kind === "video" && item.mid !== null);
        if (type === "offer") {
          [peer.screen,peer.camera] = videoLines;
          for (const line of videoLines) line.direction = "sendrecv";
          await Promise.all([screenShare.attachPeer(state,peer),attachCamera(state,peer)]);
        }
        if (peer.screen && !peer.screenStream) screenShare.receiveTrack(state,peer,peer.screen.receiver.track);
        if (peer.camera && !peer.cameraStream) peer.cameraStream = new MediaStream([peer.camera.receiver.track]);
        if (type === "offer") await advertise(state,peer,await pc.createAnswer());
      });
    }
  }

  function resetSession() {
    clearInterval(meterTimer);
    screenShare.reset(session);
    pendingCamera = undefined;
    stopCamera(session);
    if (session) {
      for (const tile of session.tiles.values()) showCamera(tile,null);
      for (const id of session.peers.keys()) removePeer(session,id);
      unwatch(session,session.peer);
      for (const track of session.stream.getTracks()) track.stop();
    }
    session = undefined;
    updateCameraButton();
    tiles.replaceChildren();
    enableAudio.hidden = true;
    mute.setAttribute("aria-pressed","false");
    mute.setAttribute("aria-label","Mute microphone");
    mute.title = "Mute microphone";
    get("[data-mic-on]").removeAttribute("hidden");
    get("[data-mic-off]").setAttribute("hidden","");
  }

  async function tick(epoch) {
    const state = session;
    try {
      if (state) await pollSession(state);
      else {
        const calls = await api("calls");
        if (epoch !== lifecycle || session) return;
        openCalls = calls;
        const currentIds = new Set(calls.map(call => call.id));
        for (const id of dismissed) if (!currentIds.has(id)) dismissed.delete(id);
        const invite = calls.find(call => !call.joined && !dismissed.has(call.id));
        if (invite?.id !== invitation?.id) nextRing = 0;
        invitation = invite;
        if (invitation && !pending && Date.now() >= nextRing) {
          ring();
          nextRing = Date.now() + 3100;
        }
        render();
      }
    } catch (error) {
      if (state && session === state && [401,403,410].includes(error.status)) {
        resetSession();
        showError("The voice call ended.");
        render();
      } else if (state && session === state) status.textContent = "Reconnecting…";
    } finally {
      if (running && lifecycle === epoch) pollTimer = setTimeout(() => tick(epoch),800);
    }
  }

  async function join(key, expected) {
    if (pending || session) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === "undefined") {
      showError("Open m-chat on localhost or HTTPS to use voice calls.");
      return;
    }
    unlockAudio();
    const attempt = { client:crypto.randomUUID() };
    pending = attempt;
    errorNotice.hidden = true;
    render();
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio:{echoCancellation:true, noiseSuppression:true, autoGainControl:true},
      });
      if (pending !== attempt) return;
      const ticket = await api("call-join",{room:Number(key),call:expected,client:attempt.client});
      if (pending !== attempt) {
        send({...ticket,room:Number(key)},"call-leave").catch(() => {});
        return;
      }
      session = {...ticket,room:Number(key),stream,peers:new Map(),tiles:new Map(),levels:new Map(),ack:0,muted:false};
      stream = undefined;
      invitation = undefined;
      status.textContent = "Connecting…";
      watch(session,session.peer,session.stream);
      meterTimer = setInterval(drawLevels,70);
      if (String(key) !== room) openRoom(key);
    } catch (error) {
      if (pending !== attempt) return;
      if (error.name === "NotAllowedError") showError("Allow microphone access in your browser to join the call.");
      else if (error.name === "NotFoundError") showError("Connect a microphone to join the call.");
      else showError(error.status ? error.message : "Couldn’t start the voice call.");
    } finally {
      if (stream) for (const track of stream.getTracks()) track.stop();
      if (pending === attempt) pending = undefined;
      render();
    }
  }

  async function hangUp() {
    const state = session;
    if (!state) return;
    dismissed.add(state.id);
    resetSession();
    openCalls = openCalls.filter(call => call.id !== state.id);
    render();
    try { await send(state,"call-leave"); }
    catch { /* The server removes stale participants automatically. */ }
  }

  startButton.addEventListener("click",() => join(room,openCalls.find(call => String(call.room) === room)?.id));
  answerButton.addEventListener("click",() => { if (invitation) join(invitation.room,invitation.id); });
  get("[data-dismiss-call]").addEventListener("click",() => {
    if (invitation) dismissed.add(invitation.id);
    invitation = undefined;
    render();
  });
  end.addEventListener("click",hangUp);
  camera.addEventListener("click",toggleCamera);
  mute.addEventListener("click",() => {
    if (!session) return;
    session.muted = !session.muted;
    for (const track of session.stream.getAudioTracks()) track.enabled = !session.muted;
    const label = session.muted ? "Unmute microphone" : "Mute microphone";
    mute.setAttribute("aria-label",label);
    mute.setAttribute("aria-pressed",String(session.muted));
    mute.title = label;
    get("[data-mic-on]").toggleAttribute("hidden",session.muted);
    get("[data-mic-off]").toggleAttribute("hidden",!session.muted);
    const tile = session.tiles.get(session.peer);
    if (tile) {
      tile.muted.toggleAttribute("hidden",!session.muted);
      tile.element.removeAttribute("data-speaking");
    }
  });
  enableAudio.addEventListener("click",async () => {
    if (!session) return;
    unlockAudio();
    const attempts = await Promise.allSettled([...session.peers.values()].filter(peer => peer.audio.srcObject).map(peer => peer.audio.play()));
    enableAudio.hidden = attempts.every(attempt => attempt.status === "fulfilled");
  });
  root.addEventListener("pointerdown",event => {
    if (running && event.isTrusted && audioContext?.state !== "running") unlockAudio();
  });

  return {
    showRoom(key) { room = String(key); render(); },
    start() {
      if (running) return;
      running = true;
      tick(++lifecycle);
    },
    stop() {
      running = false;
      lifecycle++;
      pending = undefined;
      clearTimeout(pollTimer);
      clearTimeout(noticeTimer);
      resetSession();
      dismissed.clear();
      openCalls = [];
      invitation = undefined;
      errorNotice.hidden = true;
      nextRing = 0;
      audioContext?.close().catch(() => {});
      audioContext = undefined;
      render();
    },
    hangUp,
  };
}
