"use strict";

function createScreenShare(root, getSession, showError) {
  const get = selector => root.querySelector(selector);
  const share = get("[data-screen-share]");
  const settings = get("[data-screen-settings]");
  const form = get("[data-screen-form]");
  const resolution = get("[data-screen-resolution]");
  const rate = get("[data-screen-rate]");
  const viewer = get("[data-screen-viewer]");
  const video = get("[data-screen-video]");
  const waiting = get("[data-screen-wait]");
  const label = get("[data-screen-label]");
  const source = get("[data-screen-source]");
  const fullscreen = get("[data-screen-full]");
  const feedback = get("[data-screen-feedback]");
  const choose = form.querySelector("button[type=submit]");

  function status(text = "") {
    feedback.textContent = text;
    feedback.hidden = !text;
  }

  function setSettings(open) {
    settings.hidden = !open;
    share.setAttribute("aria-expanded",String(open));
    if (!open) status();
  }
  const profiles = {
    480: {width:854, bitRate:1_500_000},
    720: {width:1280, bitRate:3_000_000},
    1080: {width:1920, bitRate:5_500_000},
  };
  let pending;
  let selected;
  let people = [];
  let optionKey;

  function isSharing(state) {
    return state?.display?.track.readyState === "live";
  }

  function showWaiting() {
    waiting.hidden = viewer.hidden || Boolean(video.srcObject && video.readyState >= 2);
  }

  function render(state = getSession()) {
    const local = isSharing(state) ? [{peer:state.peer,name:"Your screen",stream:state.display.stream}] : [];
    const remote = people.filter(person => person.peer !== state?.peer && person.sharing)
      .map(person => ({peer:person.peer,name:person.name + "’s screen",stream:state?.peers.get(person.peer)?.screenStream}));
    const screens = [...local,...remote];
    if (!screens.some(screen => screen.peer === selected)) selected = screens[0]?.peer;
    const current = screens.find(screen => screen.peer === selected);
    const nextStream = current?.stream ?? null;
    if (video.srcObject !== nextStream) {
      video.srcObject = nextStream;
      if (nextStream) video.play().catch(() => {});
    }
    viewer.hidden = !current;
    if (!current) {
      viewer.removeAttribute("data-expanded");
      updateFullscreen();
      if (document.fullscreenElement === viewer) document.exitFullscreen().catch(() => {});
    }
    label.textContent = current?.name ?? "";
    const nextKey = JSON.stringify(screens.map(screen => [screen.peer,screen.name]));
    if (nextKey !== optionKey) {
      optionKey = nextKey;
      source.replaceChildren(...screens.map(screen => new Option(screen.name,screen.peer)));
    }
    source.hidden = screens.length <= 1;
    source.value = selected ?? "";
    share.disabled = Boolean(pending);
    choose.disabled = Boolean(pending) || !navigator.mediaDevices?.getDisplayMedia;
    resolution.disabled = Boolean(pending);
    rate.disabled = Boolean(pending);
    share.setAttribute("aria-pressed",String(isSharing(state)));
    const buttonLabel = isSharing(state) ? "Stop sharing screen" : "Share screen";
    share.setAttribute("aria-label",buttonLabel);
    share.title = buttonLabel;
    showWaiting();
  }

  function attachPeer(state, peer) {
    if (!peer.screen) return;
    const sender = peer.screen.sender;
    peer.displayUpdate = (peer.displayUpdate ?? Promise.resolve()).then(async () => {
      if (state !== getSession() || peer.pc.signalingState === "closed") return;
      const display = isSharing(state) ? state.display : undefined;
      const track = display?.track ?? null;
      if (sender.track !== track) await sender.replaceTrack(track);
      if (!display || peer.pc.connectionState !== "connected") return;
      const parameters = sender.getParameters();
      if (parameters.encodings?.length) {
        parameters.encodings[0].maxBitrate = display.bitRate;
        parameters.encodings[0].maxFramerate = display.frameRate;
        await sender.setParameters(parameters).catch(() => {});
      }
    }).catch(() => {
      if (state === getSession() && isSharing(state) && peer.pc.signalingState !== "closed") {
        showError("A participant couldn’t receive your screen. Try a lower resolution.");
      }
    });
    return peer.displayUpdate;
  }

  function stop(state) {
    if (!state?.display) return;
    const {track} = state.display;
    state.display = undefined;
    track.stop();
    for (const peer of state.peers.values()) attachPeer(state,peer);
    render(state);
  }

  async function start(state) {
    const mode = profiles[resolution.value] ?? profiles[720];
    const height = Number(resolution.value);
    const frameRate = Number(rate.value);
    const attempt = {};
    pending = attempt;
    status("Choose a screen, window, or tab in your browser.");
    render(state);
    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width:{ideal:mode.width,max:mode.width},
          height:{ideal:height,max:height},
          frameRate:{ideal:frameRate,max:frameRate},
        },
        audio:false,
      });
      if (state !== getSession() || pending !== attempt) return;
      const track = stream.getVideoTracks()[0];
      if (!track || track.readyState !== "live") {
        status("The browser didn’t provide a screen stream. Try choosing a different window or tab.");
        return;
      }
      track.contentHint = "motion";
      state.display = {stream,track,frameRate,bitRate:mode.bitRate * (frameRate === 60 ? 1.5 : 1)};
      stream = undefined;
      track.addEventListener("ended",() => {
        if (state === getSession() && state.display?.track === track) stop(state);
      },{once:true});
      setSettings(false);
      selected = state.peer;
      for (const peer of state.peers.values()) attachPeer(state,peer);
    } catch (error) {
      if (state !== getSession() || pending !== attempt) return;
      const messages = {
        NotAllowedError: "Screen sharing was canceled or blocked. Try again and confirm Share in the browser picker.",
        NotFoundError: "The browser couldn’t find a screen or window to share.",
        NotReadableError: "The browser couldn’t capture that source. Try a different window or tab.",
        InvalidStateError: "Keep m-chat focused and click Choose what to share again.",
        OverconstrainedError: "This source doesn’t support the selected quality. Try 720p at 30 fps.",
      };
      status(messages[error.name] ?? "Couldn’t start screen sharing. Try a different window or lower quality.");
    } finally {
      if (stream) for (const track of stream.getTracks()) track.stop();
      if (pending === attempt) pending = undefined;
      render();
    }
  }

  share.addEventListener("click",() => {
    const state = getSession();
    if (!state || pending) return;
    if (isSharing(state)) {
      stop(state);
      return;
    }
    setSettings(settings.hidden);
    if (!settings.hidden) {
      if (!navigator.mediaDevices?.getDisplayMedia) {
        status("Screen sharing is unavailable here. Open m-chat directly in Edge or Chrome on localhost or HTTPS.");
      }
      resolution.focus();
    }
    render(state);
  });
  form.addEventListener("submit",event => {
    event.preventDefault();
    const state = getSession();
    if (state && !pending && navigator.mediaDevices?.getDisplayMedia) start(state);
  });
  get("[data-screen-cancel]").addEventListener("click",() => {
    if (pending) return;
    setSettings(false);
    share.focus();
  });
  source.addEventListener("change",() => { selected = source.value; render(); });
  video.addEventListener("loadeddata",showWaiting);
  video.addEventListener("emptied",showWaiting);
  function updateFullscreen() {
    const full = document.fullscreenElement === viewer || viewer.hasAttribute("data-expanded");
    const text = full ? "Exit fullscreen" : "Fullscreen";
    fullscreen.setAttribute("aria-label",text);
    fullscreen.title = text;
  }
  fullscreen.addEventListener("click",async () => {
    if (document.fullscreenElement === viewer) {
      await document.exitFullscreen().catch(() => {});
    } else if (viewer.hasAttribute("data-expanded")) {
      viewer.removeAttribute("data-expanded");
    } else {
      try {
        await viewer.requestFullscreen();
      } catch {
        if (!viewer.hidden) viewer.setAttribute("data-expanded","");
      }
    }
    updateFullscreen();
  });
  document.addEventListener("fullscreenchange",updateFullscreen);
  document.addEventListener("keydown",event => {
    if (event.key !== "Escape" || !viewer.hasAttribute("data-expanded")) return;
    viewer.removeAttribute("data-expanded");
    updateFullscreen();
    fullscreen.focus();
  });

  return {
    attachPeer,
    isSharing,
    updatePeople(state, participants) {
      people = participants;
      render(state);
    },
    receiveTrack(state, peer, track) {
      peer.screenStream = new MediaStream([track]);
      render(state);
    },
    reset(state) {
      pending = undefined;
      setSettings(false);
      if (state?.display) {
        state.display.track.stop();
        state.display = undefined;
      }
      selected = undefined;
      people = [];
      render();
    },
  };
}
