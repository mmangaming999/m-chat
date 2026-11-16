(() => {
  const root = document.getElementById("mchat-test");
  const get = selector => root.querySelector(selector);
  const brandMark = get(".brand .mark");
  function fitLogoWall(homeWall) {
    if (!homeWall.clientWidth || !homeWall.clientHeight) return;
    const columns = Math.ceil(homeWall.clientWidth / 116) + 1;
    const rows = Math.ceil(homeWall.clientHeight / 60);
    const wall = document.createDocumentFragment();

    for (let row = 0; row < rows; row++) {
      const line = document.createElement("div");
      line.className = "home-wall-row";
      for (let column = 0; column < columns; column++) {
        const tile = document.createElement("span");
        tile.className = "home-wall-cell";
        tile.append(brandMark.cloneNode(true), "m-chat");
        line.append(tile);
      }
      wall.append(line);
    }
    homeWall.replaceChildren(wall);
  }
  const wallObserver = new ResizeObserver(entries => {
    for (const entry of entries) fitLogoWall(entry.target);
  });
  document.querySelectorAll("[data-logo-wall]").forEach(wall => wallObserver.observe(wall));
  const input = get(".composer input[type=text]");
  const mediaPickers = createMediaPickers(root,input,setAttachment);
  const dialog = get("[data-view-profile]");
  const members = get("[data-members]");
  const list = get("[data-list]");
  let active = "home";
  let selectedChannel;
  let snapshot;
  let currentView;
  let selfPhoto;
  let attachment;
  let generation = 0;
  const rooms = Object.create(null);
  let selfProfile = [];
  const chatStatus = get("[data-chat-status]");
  function report(error) {
    chatStatus.textContent = error.message || "Couldn’t connect.";
    const dialog = root.querySelector("dialog[open]:last-of-type") || root.querySelector("dialog[open]");
    if (dialog) {
      let status = dialog.querySelector(".api-error");
      if (!status) {
        status = element("p", "", "api-error");
        status.setAttribute("role", "alert");
        dialog.append(status);
      }
      status.textContent = chatStatus.textContent;
    }
  }
  async function api(route, data) {
    const options = data === undefined ? {} : {
      method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(data)
    };
    const response = await fetch("/api/" + route, {...options, signal:AbortSignal.timeout(12000)});
    const result = await response.json();
    if (!response.ok) throw Object.assign(new Error(result.error), {status:response.status});
    return result;
  }
  const voice = createVoiceCalls(root, api, key => rooms[key], showRoom);
  function element(tag, text, className) {
    const node = document.createElement(tag);
    node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function portrait(person, photo = person.id === snapshot?.me.id ? selfPhoto : null) {
    const src = photo?.url || person.image;
    if (src) {
      const image = document.createElement("img");
      image.src = src;
      image.alt = "";
      image.className = "profile-photo" + (photo?.pixels ? " pixel-logo" : "");
      return image;
    }
    return element("span", person.name.slice(0,2).toUpperCase(), "room-logo");
  }
  function picture(person) {
    const node = button("", () => openPerson(person));
    node.classList.add("pfp");
    node.append(portrait(person));
    node.setAttribute("aria-label", "Open " + person.name + " profile");
    return node;
  }
  function openPerson(person) {
    if (person.id === snapshot.me.id) return openProfileEditor();
    get("[data-profile]").replaceChildren(portrait(person), element("h3",person.name),
      element("p","@" + person.handle,"sub"),element("p",person.bio),
      element("p","Mood · " + (person.mood || "—")),element("p","Games · " + (person.games || "—")));
    dialog.showModal();
  }
  const logoDialog = get("[data-logo-dialog]");
  const logoFile = get("[data-logo-file]");
  const pixelGrid = get("[data-pixels]");
  const pixelContext = pixelGrid.getContext("2d");
  const pixelBoard = pixelGrid.parentElement;
  const preview = get("[data-logo-preview]");
  const status = get("[data-logo-status]");
  const saveLogo = get("[data-logo-save]");
  const color = get("[data-logo-color]");
  const size = pixelGrid.width;
  const profileEditor = get("[data-profile-editor]");
  const profileForm = get("[data-profile-form]");
  const profileStatus = get("[data-profile-status]");
  const profilePictureButton = get("[data-edit-picture]");
  const profilePicturePreview = get("[data-edit-picture-preview]");
  let draftPhoto;
  const username = get("[data-username]");
  const bioInput = get("[data-bio]");
  const moodInput = get("[data-mood]");
  let editor;
  let pointerId;
  let priorCell;
  let keyboardCell;

  function openProfileEditor() {
    draftPhoto = selfPhoto;
    username.value = selfProfile[0];
    bioInput.value = selfProfile[1];
    moodInput.value = selfProfile[2];
    get("[data-games]").value = snapshot.me.games;
    profileStatus.textContent = "";
    profilePicturePreview.replaceChildren(portrait(snapshot.me, draftPhoto));
    profileEditor.showModal();
  }

  profilePictureButton.addEventListener("click", () => openImageEditor("You"));
  get("[data-profile-cancel]").addEventListener("click", () => profileEditor.close());
  profileForm.addEventListener("submit", async event => {
    event.preventDefault();
    const handle = username.value.trim().replace(/^@/, "");
    if (!/^[a-zA-Z0-9_]{1,24}$/.test(handle)) {
      profileStatus.textContent = "Use 1–24 letters, numbers, or underscores for your username.";
      username.focus();
      return;
    }
    try {
      const person = await api("profile",{handle,bio:bioInput.value,mood:moodInput.value,
        games:get("[data-games]").value,image:draftPhoto?.url ?? null});
      selfPhoto = draftPhoto;
      setMe(person);
      profileEditor.close();
      render();
    } catch (error) {
      profileStatus.textContent = error.message;
    }
  });

  function setLogo(target, roomKey) {
    const logo = rooms[roomKey].logo;
    target.replaceChildren();
    if (logo) {
      const image = document.createElement("img");
      image.src = logo.url;
      image.alt = "";
      image.classList.toggle("pixel-logo", Boolean(logo.pixels));
      target.append(image);
    } else {
      target.textContent = rooms[roomKey].title.slice(0,2).toUpperCase();
    }
  }

  function updatePreview(url, isPixel = false) {
    const image = document.createElement("img");
    image.src = url;
    image.alt = "";
    image.classList.toggle("pixel-logo", isPixel);
    preview.replaceChildren(image);
    saveLogo.disabled = false;
  }

  function capturePixels() {
    const pixels = pixelContext.getImageData(0, 0, size, size);
    editor.drafts.draw = { url: pixelGrid.toDataURL(), pixels };
    updatePreview(editor.drafts.draw.url, true);
  }

  function showLogoMode(mode) {
    editor.mode = mode;
    get("[data-logo-upload-panel]").hidden = mode !== "upload";
    get("[data-logo-draw-panel]").hidden = mode !== "draw";
    logoDialog.querySelectorAll("[data-logo-mode]").forEach(button => {
      button.setAttribute("aria-pressed", String(button.dataset.logoMode === mode));
    });
    const draft = editor.drafts[mode];
    if (draft) {
      updatePreview(draft.url, mode === "draw");
      return;
    }
    if (editor.room === "You") preview.replaceChildren(portrait(snapshot.me, draftPhoto));
    else setLogo(preview, editor.room);
    saveLogo.disabled = true;
  }

  function openImageEditor(room) {
    if (room === "dm") return;
    const isProfile = room === "You";
    const logo = isProfile ? draftPhoto : rooms[room].logo;
    editor = { room, drafts: logo ? { [logo.pixels ? "draw" : "upload"]: logo } : {} };
    logoDialog.classList.toggle("profile-image", isProfile);
    get("[data-logo-title]").textContent = isProfile ? "Change profile picture" : "Edit " + rooms[room].title + " logo";
    preview.setAttribute("aria-label", isProfile ? "Profile picture preview" : "Logo preview");
    saveLogo.textContent = isProfile ? "Use picture" : "Save logo";
    status.textContent = "";
    logoFile.value = "";
    priorCell = undefined;
    pixelBoard.style.setProperty("--cell-x", 0);
    pixelBoard.style.setProperty("--cell-y", 0);
    keyboardCell = { x: 0, y: 0 };
    pixelContext.clearRect(0, 0, size, size);
    if (logo?.pixels) pixelContext.putImageData(logo.pixels, 0, 0);
    erase.setAttribute("aria-pressed", "false");
    showLogoMode(editor.drafts.upload ? "upload" : "draw");
    logoDialog.showModal();
  }

  function drawPixels(from, to, erasing, ctx = pixelContext) {
    const steps = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y), 1);
    ctx.fillStyle = color.value;
    for (let step = 0; step <= steps; step++) {
      const x = Math.round(from.x + (to.x - from.x) * step / steps);
      const y = Math.round(from.y + (to.y - from.y) * step / steps);
      if (erasing) ctx.clearRect(x, y, 1, 1);
      else ctx.fillRect(x, y, 1, 1);
    }
  }

  const erase = get("[data-logo-erase]");
  const isErasing = () => erase.getAttribute("aria-pressed") === "true";
  function paintPointer(event) {
    const bounds = pixelGrid.getBoundingClientRect();
    const index = (coordinate, start, extent) =>
      Math.max(0, Math.min(size - 1, Math.floor((coordinate - start) * size / extent)));
    const cell = {
      x: index(event.clientX, bounds.left, bounds.width),
      y: index(event.clientY, bounds.top, bounds.height)
    };
    drawPixels(priorCell ?? cell, cell, isErasing());
    priorCell = cell;
  }

  pixelGrid.addEventListener("pointerdown", event => {
    if (event.button !== 0 || pointerId !== undefined) return;
    pointerId = event.pointerId;
    priorCell = undefined;
    pixelGrid.setPointerCapture(pointerId);
    paintPointer(event);
    capturePixels();
  });
  pixelGrid.addEventListener("pointermove", event => {
    if (pointerId !== event.pointerId) return;
    paintPointer(event);
  });
  pixelGrid.addEventListener("lostpointercapture", event => {
    if (pointerId !== event.pointerId) return;
    pointerId = undefined;
    if (editor && logoDialog.open && editor.mode === "draw") capturePixels();
  });
  pixelGrid.addEventListener("keydown", event => {
    if (event.key === " " || event.key === "Enter") {
      drawPixels(keyboardCell, keyboardCell, isErasing());
      capturePixels();
    } else {
      const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
      if (!direction) return;
      keyboardCell.x = Math.max(0, Math.min(size - 1, keyboardCell.x + direction[0]));
      keyboardCell.y = Math.max(0, Math.min(size - 1, keyboardCell.y + direction[1]));
      pixelBoard.style.setProperty("--cell-x", keyboardCell.x);
      pixelBoard.style.setProperty("--cell-y", keyboardCell.y);
    }
    event.preventDefault();
  });

  logoFile.addEventListener("change", async () => {
    const file = logoFile.files[0];
    if (!file) return;
    const edit = editor;
    const request = Symbol();
    edit.request = request;
    const isCurrent = () => editor === edit && edit.request === request && editor.mode === "upload";
    status.textContent = "";
    saveLogo.disabled = true;
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      if (!isCurrent()) return;
      const square = Math.min(image.naturalWidth, image.naturalHeight);
      if (!square) throw new Error("Empty image");
      const thumbnail = document.createElement("canvas");
      thumbnail.width = thumbnail.height = 160;
      thumbnail.getContext("2d").drawImage(image,
        (image.naturalWidth - square) / 2, (image.naturalHeight - square) / 2,
        square, square, 0, 0, 160, 160);
      edit.drafts.upload = { url: thumbnail.toDataURL() };
      updatePreview(edit.drafts.upload.url);
    } catch {
      if (isCurrent()) {
        showLogoMode("upload");
        status.textContent = "Couldn’t open that image. Try a PNG, JPEG, or WebP.";
      }
    } finally {
      URL.revokeObjectURL(url);
    }
  });

  logoDialog.addEventListener("close", () => {
    if (logoDialog.open) return;
    editor = undefined;
    if (profileEditor.open) profilePictureButton.focus();
  });
  logoDialog.addEventListener("click", async event => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.logoMode) {
      editor.request = null;
      status.textContent = "";
      showLogoMode(button.dataset.logoMode);
    }
    if (button === erase) button.setAttribute("aria-pressed", String(!isErasing()));
    if (button.matches("[data-logo-clear]")) {
      pixelContext.clearRect(0, 0, size, size);
      capturePixels();
    }
    if (button.matches("[data-logo-cancel]")) logoDialog.close();
    if (button === saveLogo && !saveLogo.disabled) {
      const image = editor.drafts[editor.mode];
      if (!image) return;
      if (editor.room === "You") {
        draftPhoto = image;
        profilePicturePreview.replaceChildren(portrait(snapshot.me, draftPhoto));
        logoDialog.close();
      } else {
        const room = editor.room;
        saveLogo.disabled = true;
        try {
          await api("logo",{room:Number(room),image:image.url});
          rooms[room].logo = image;
          logoDialog.close();
          render();
        } catch (error) {
          status.textContent = error.message;
          saveLogo.disabled = false;
        }
      }
    }
  });

  function button(label, action) {
    const node = element("button", label, "cursor-interaction");
    node.type = "button";
    node.addEventListener("click", async () => {
      if (node.disabled) return;
      node.disabled = true;
      try { await action(); }
      catch (error) { report(error); }
      finally { node.disabled = false; }
    });
    return node;
  }
  function setMe(person) {
    snapshot.me = person;
    selfProfile = [person.handle, person.bio, person.mood];
    if (person.image !== selfPhoto?.url) selfPhoto = person.image ? {url:person.image} : undefined;
  }
  function setAttachment(value) {
    attachment = value;
    const chip = get("[data-attachment]");
    chip.hidden = !value;
    chip.textContent = value ? value.name + " · Remove" : "";
  }
  function showRoom(key, channel) {
    active = String(key);
    selectedChannel = channel ?? rooms[active]?.channels[0]?.id;
    currentView = undefined;
    generation++;
    input.value = "";
    mediaPickers.close();
    setAttachment(undefined);
    chatStatus.textContent = "";
    get("[data-messages]").replaceChildren();
    render();
    loadRoom().catch(report);
  }
  function renderNav() {
    const nav = get("[data-nav]");
    const nodes = [];
    for (const [kind, label] of [["dm","Direct messages"],["group","Group chats"],["server","Public servers"]]) {
      const entries = snapshot.chats.filter(room => room.kind === kind);
      if (!entries.length) continue;
      nodes.push(element("span",label,"nav-label"));
      for (const room of entries) {
        const key = String(room.id);
        const node = button("", () => showRoom(key));
        node.classList.add("room-entry");
        node.dataset.room = key;
        const image = room.peer ? portrait(room.peer) : element("span","","room-logo");
        if (!room.peer) setLogo(image,key);
        image.setAttribute("aria-hidden","true");
        node.append(image,element("span",room.title));
        nodes.push(node);
      }
    }
    nav.replaceChildren(...nodes);
  }
  let recentKey;
  function renderRecentChats() {
    const recent = snapshot.recent.map(post => ({post,room:rooms[post.room]}))
      .filter(({room}) => room);
    const key = JSON.stringify(recent.map(({post,room}) => [post,room.title,room.image,room.peer?.image]));
    if (key === recentKey) return;
    recentKey = key;
    get("[data-recent-section]").hidden = !recent.length;
    get("[data-recent-list]").replaceChildren(...recent.map(({post,room}) => {
      const node = button("", () => showRoom(room.id,post.channel));
      node.classList.add("recent-chat");
      const image = room.peer ? portrait(room.peer) : element("span","","room-logo");
      if (!room.peer) setLogo(image,room.id);
      image.setAttribute("aria-hidden","true");
      const title = element("strong",room.title);
      const snippet = element("small",post.body || (post.attachment === "gif" ? "GIF" : post.attachment ? "Image attachment" : ""));
      const labels = element("span","");
      labels.append(title,snippet);
      node.append(image,labels);
      return node;
    }));
  }
  function render() {
    if (!snapshot) return;
    voice.showRoom(active);
    const isHome = active === "home";
    get("[data-home]").hidden = !isHome;
    get("[data-conversation]").hidden = isHome;
    root.querySelectorAll("[data-room]").forEach(node =>
      node.setAttribute("aria-pressed", String(node.dataset.room === active)));
    get("[data-self-picture]").replaceChildren(portrait(snapshot.me));
    get("[data-self-username]").textContent = "@" + snapshot.me.handle;
    get("[data-home-picture]").replaceChildren(portrait(snapshot.me));
    if (isHome) { renderRecentChats(); return; }
    const room = rooms[active];
    const channel = room.channels.find(item => item.id === selectedChannel);
    const isDm = room.kind === "dm";
    const isServer = room.kind === "server";
    const canManage = room.role !== "member";
    get("[data-conversation] h2").textContent = room.title;
    get("[data-kind]").textContent = isServer ? "#" + channel?.title + " · Public server" :
      isDm ? "Direct message" : "Private group chat";
    input.placeholder = "Message " + (isServer ? "#" + channel?.title : room.title);
    get("[data-edit-logo]").hidden = isDm || !canManage;
    get("[data-header-logo]").hidden = isDm;
    if (!isDm) setLogo(get("[data-header-logo]"), active);
    get("[data-manage]").hidden = isDm;
    const select = get("[data-channels]");
    select.hidden = !isServer;
    const channelKey = JSON.stringify(room.channels);
    if (select.dataset.channels !== channelKey) {
      select.replaceChildren(...room.channels.map(item => new Option("#" + item.title,item.id)));
      select.dataset.channels = channelKey;
    }
    select.value = selectedChannel;
    members.hidden = isDm;
    if (isDm) list.hidden = true;
    members.setAttribute("aria-expanded",String(!list.hidden));
  }
  function renderMessages(view) {
    const feed = get(".feed");
    const bottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 50;
    const dates = new Intl.DateTimeFormat(undefined,{dateStyle:"medium",timeStyle:"short"});
    const byId = new Map(view.people.map(person => [person.id,person]));
    const messages = get("[data-messages]");
    const existingGifs = new Map([...messages.querySelectorAll("[data-remote-post]")].map(node => [Number(node.dataset.remotePost),node]));
    messages.replaceChildren(...view.posts.map(post => {
      const mine = post.uid === snapshot.me.id;
      const person = byId.get(post.uid);
      const row = element("div","","message" + (mine ? " mine" : ""));
      const meta = element("div","","meta");
      const time = element("time",dates.format(new Date(post.created)));
      time.dateTime = post.created;
      meta.append(element("strong",mine ? "You" : person?.name ?? "Former member","sender-name"),time);
      const bubble = element("div",post.body,"bubble");
      if (post.image?.startsWith("giphy:")) {
        const gif = existingGifs.get(post.id) ?? element("div","Loading GIF…");
        gif.dataset.remotePost = post.id;
        gif.dataset.gif = post.image.slice(6);
        bubble.append(gif);
      } else if (post.image) {
        const image = document.createElement("img");
        const localGif = post.image.startsWith("local:");
        image.src = localGif ? mediaPickers.localUrl(post.image.slice(6)) : post.image;
        image.alt = localGif ? post.image.slice(6).replaceAll("-"," ") + " reaction GIF" : "Image attachment";
        image.className = "attachment";
        bubble.append(image);
      }
      const thumb = person ? picture(person) : element("span","?","pfp room-logo");
      row.append(thumb,meta,bubble);
      return row;
    }));
    const unresolved = messages.querySelectorAll("[data-remote-post]:not([data-loading])");
    if (unresolved.length) mediaPickers.resolveGifs(unresolved);
    if (bottom) feed.scrollTop = feed.scrollHeight;
    get("[data-member-rows]").replaceChildren(...view.members.map(person => {
      const row = element("p","");
      row.append(picture(person),person.id === snapshot.me.id ? "You" : person.name);
      return row;
    }));
  }
  let loadingView;
  async function loadRoom() {
    if (!selectedChannel || active === "home") return;
    const ticket = generation;
    if (loadingView === ticket) return;
    loadingView = ticket;
    const previous = currentView;
    const room = active;
    try {
      const after = previous?.posts.at(-1)?.id;
      const query = new URLSearchParams({room, channel:selectedChannel});
      if (after !== undefined) query.set("after",after);
      const result = await api("view?" + query);
      if (ticket !== generation) return;
      const posts = [...(previous?.posts ?? []),...result.posts].slice(-250);
      const people = new Map((previous?.people ?? []).map(person => [person.id,person]));
      for (const person of [...result.members,...result.authors]) people.set(person.id,person);
      const next = {...result,posts,people:[...people.values()]};
      const changed = !previous || result.posts.length || JSON.stringify(previous.members) !== JSON.stringify(next.members);
      currentView = next;
      if (changed) renderMessages(next);
    } catch (error) {
      if (ticket !== generation) return;
      if ([403,404].includes(error.status)) {
        await refresh();
        return;
      }
      if (error.status === 401) return leave();
      throw error;
    } finally {
      if (loadingView === ticket) loadingView = undefined;
    }
  }
  let navKey;
  let stateSequence = 0;
  let appliedSequence = 0;
  async function refresh() {
    const sequence = ++stateSequence;
    const next = await api("state");
    if (sequence < appliedSequence) return;
    appliedSequence = sequence;
    snapshot = next;
    setMe(next.me);
    const key = JSON.stringify(next.chats);
    for (const item of Object.keys(rooms)) delete rooms[item];
    for (const room of next.chats) room.logo = room.image ? {url:room.image} : null;
    for (const room of next.chats) rooms[room.id] = room;
    if (navKey !== key) { navKey = key; renderNav(); }
    if (active !== "home" && !rooms[active]) showRoom("home");
    else if (active !== "home" && !rooms[active].channels.some(channel => channel.id === selectedChannel)) showRoom(active);
    else render();
  }
  const directory = get("[data-directory-dialog]");
  const settings = get("[data-settings-dialog]");
  async function mutate(route,data,open = false) {
    const result = await api(route,data);
    await refresh();
    if (open) {
      directory.close();
      showRoom(result.id);
    }
    if (directory.open) renderDirectory();
    if (settings.open) {
      await loadRoom();
      renderSettings();
    }
    return result;
  }
  function row(parent, label, ...actions) {
    const item = element("div","","item-row");
    item.append(element("span",label),...actions);
    parent.append(item);
  }
  function section(parent,title) {
    parent.append(element("h4",title));
  }
  let directoryKey;
  function renderDirectory() {
    const key = JSON.stringify([snapshot.friendships,snapshot.invites,snapshot.servers]);
    if (directoryKey === key) return;
    directoryKey = key;
    const items = get("[data-directory-items]");
    items.replaceChildren();
    section(items,"Friends");
    if (!snapshot.friendships.length) row(items,"No friend requests or friends yet.");
    for (const {person,accepted,incoming} of snapshot.friendships) {
      const label = person.name + " · @" + person.handle;
      const data = {user:person.id};
      if (accepted) row(items,label,button("Message",() => mutate("dm",data,true)));
      else if (incoming) row(items,label,button("Accept",() => mutate("friend-response",{...data,accept:true})),
        button("Decline",() => mutate("friend-response",{...data,accept:false})));
      else row(items,label + " · Request sent");
    }
    if (snapshot.invites.length) section(items,"Group invites");
    for (const invite of snapshot.invites) row(items,invite.title,
      button("Join",() => mutate("join",{room:invite.id},true)),
      button("Decline",() => mutate("decline-invite",{room:invite.id})));
    const servers = element("h4","Public servers");
    servers.id = "mchat-public-servers";
    items.append(servers);
    if (!snapshot.servers.length) row(items,"No other public servers yet.");
    for (const server of snapshot.servers) row(items,server.title,
      button("Join",() => mutate("join",{room:server.id},true)));
  }
  function renderSettings() {
    const items = get("[data-settings-items]");
    items.replaceChildren();
    const room = rooms[active];
    if (!room) return;
    const manage = room.role !== "member";
    const server = room.kind === "server";
    const data = {room:room.id};
    if (!server) {
      if (manage) {
        const label = element("label","");
        const toggle = document.createElement("input");
        toggle.type = "checkbox";
        toggle.checked = Boolean(room.history);
        toggle.addEventListener("change",async () => {
          toggle.disabled = true;
          try { await mutate("group-history",{...data,enabled:toggle.checked}); }
          catch (error) { toggle.checked = !toggle.checked; report(error); }
          finally { toggle.disabled = false; }
        });
        label.append(toggle," Let new members see earlier messages");
        items.append(label);
      }
      section(items,"Add or invite a friend");
      for (const entry of snapshot.friendships.filter(entry => entry.accepted &&
          !currentView?.members.some(person => person.id === entry.person.id))) {
        const person = entry.person;
        row(items,person.name,button("Add",() => mutate("group-add",{...data,user:person.id})),
          button("Invite",() => mutate("group-add",{...data,user:person.id,invite:true})));
      }
    }
    if (manage && server) {
      section(items,"Channels");
      const field = document.createElement("input");
      field.placeholder = "Channel name";
      field.maxLength = 36;
      field.setAttribute("aria-label","Channel name");
      const fields = element("div","","item-row");
      fields.append(field,button("Add channel",() => mutate("channel",{...data,title:field.value})));
      items.append(fields);
      for (const channel of room.channels) {
        const field = document.createElement("input");
        field.value = channel.title;
        field.maxLength = 36;
        field.setAttribute("aria-label","Rename " + channel.title);
        const actions = element("div","","item-row");
        actions.append(field,button("Rename",() => mutate("rename-channel",{...data,channel:channel.id,title:field.value})));
        if (room.channels.length > 1) actions.append(button("Remove",() => mutate("remove-channel",{...data,channel:channel.id})));
        items.append(actions);
      }
    }
    if (manage) {
      section(items,"Members");
      for (const person of currentView?.members ?? []) {
        const options = [];
        const target = {...data,user:person.id};
        if (person.role !== "owner" && person.id !== snapshot.me.id) {
          if (room.role === "owner") options.push(button(person.role === "manager" ? "Remove role" : server ? "Make moderator" : "Make manager",
            () => mutate("role",{...target,enabled:person.role !== "manager"})));
          if (server && (person.role !== "manager" || room.role === "owner")) {
            options.push(button("Kick",() => mutate("kick",target)),button("Ban",() => mutate("ban",target)));
          }
        }
        row(items,person.name + " · " + (server && person.role === "manager" ? "moderator" : person.role),...options);
      }
      for (const person of currentView?.banned ?? []) row(items,person.name + " · Banned",
        button("Unban",() => mutate("unban",{...data,user:person.id})));
    }
  }
  get(".brand").addEventListener("click",() => showRoom("home"));
  root.querySelectorAll('[data-profile-name="You"]').forEach(node => node.addEventListener("click",openProfileEditor));
  get("[data-edit-logo]").addEventListener("click",() => openImageEditor(active));
  members.addEventListener("click",() => {
    list.hidden = !list.hidden;
    members.setAttribute("aria-expanded",String(!list.hidden));
  });
  get("[data-channels]").addEventListener("change",event => showRoom(active,Number(event.target.value)));
  async function openDirectory(destination) {
    try {
      await refresh();
      renderDirectory();
      if (!directory.open) directory.showModal();
      if (destination === "friend") get("[data-friend-form] input").focus();
      if (destination === "group") {
        get("[data-create-form] select").value = "group";
        get("[data-create-form] input").focus();
      }
      if (destination === "servers") {
        const heading = get("#mchat-public-servers");
        heading.tabIndex = -1;
        heading.focus();
        heading.scrollIntoView({block:"nearest"});
      }
    } catch (error) { report(error); }
  }
  get("[data-directory]").addEventListener("click",() => openDirectory());
  root.querySelectorAll("[data-open-directory]").forEach(node =>
    node.addEventListener("click",() => openDirectory(node.dataset.openDirectory)));
  get("[data-manage]").addEventListener("click",async () => {
    try { await loadRoom(); renderSettings(); settings.showModal(); }
    catch (error) { report(error); }
  });
  for (const [selector,route,open] of [["[data-friend-form]","friend",false],["[data-create-form]","create",true]]) {
    const form = get(selector);
    form.addEventListener("submit",async event => {
      event.preventDefault();
      const submit = form.querySelector("button");
      if (submit.disabled) return;
      submit.disabled = true;
      try { await mutate(route,Object.fromEntries(new FormData(form)),open); form.reset(); }
      catch (error) { report(error); }
      finally { submit.disabled = false; }
    });
  }
  const fileInput = get("[data-file]");
  get('[data-pick="upload"]').addEventListener("click",() => fileInput.click());
  get("[data-attachment]").addEventListener("click",() => setAttachment(undefined));
  fileInput.addEventListener("change",async () => {
    const file = fileInput.files[0];
    fileInput.value = "";
    if (!file) return;
    const ticket = generation;
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      const factor = Math.min(1,1200 / Math.max(image.naturalWidth,image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1,Math.round(image.naturalWidth * factor));
      canvas.height = Math.max(1,Math.round(image.naturalHeight * factor));
      canvas.getContext("2d").drawImage(image,0,0,canvas.width,canvas.height);
      let data = canvas.toDataURL("image/webp",.8);
      if (data.length > 800000) data = canvas.toDataURL("image/webp",.5);
      if (data.length > 800000) throw new Error("This image is too large to attach.");
      if (ticket === generation) setAttachment({name:file.name,data});
    } catch (error) { if (ticket === generation) report(error); }
    finally { URL.revokeObjectURL(url); }
  });
  get(".composer > form").addEventListener("submit",async event => {
    event.preventDefault();
    const submit = event.currentTarget.querySelector("[type=submit]");
    const text = input.value.trim();
    if (submit.disabled || !selectedChannel || (!text && !attachment)) return;
    const ticket = generation;
    submit.disabled = true;
    try {
      await api("post",{room:Number(active),channel:selectedChannel,body:text,image:attachment?.kind === "gif" ? undefined : attachment?.data,
        gif:attachment?.kind === "gif" ? attachment.data : undefined});
      if (ticket !== generation) return;
      input.value = "";
      setAttachment(undefined);
      chatStatus.textContent = "";
      await loadRoom();
      get(".feed").scrollTop = get(".feed").scrollHeight;
    } catch (error) { if (ticket === generation) report(error); }
    finally { submit.disabled = false; }
  });

  const authScreen = document.getElementById("auth-screen");
  const auth = document.getElementById("container");
  const signup = document.getElementById("signup-form");
  const login = document.getElementById("login-form");
  function showAuth(create) {
    auth.classList.toggle("active",create);
    signup.inert = !create;
    login.inert = create;
  }
  document.getElementById("register").addEventListener("click",() => showAuth(true));
  document.getElementById("login").addEventListener("click",() => showAuth(false));
  showAuth(false);
  let poll;
  function leave() {
    clearInterval(poll);
    mediaPickers.reset();
    voice.stop();
    appliedSequence = ++stateSequence;
    generation++;
    active = "home";
    selectedChannel = undefined;
    currentView = undefined;
    snapshot = undefined;
    selfPhoto = undefined;
    navKey = undefined;
    recentKey = undefined;
    directoryKey = undefined;
    root.querySelectorAll("dialog[open]").forEach(dialog => dialog.close());
    root.hidden = true;
    authScreen.hidden = false;
    document.body.classList.remove("in-chat");
    showAuth(false);
  }
  async function enter() {
    await refresh();
    authScreen.hidden = true;
    root.hidden = false;
    document.body.classList.add("in-chat");
    voice.start();
    clearInterval(poll);
    let ticks = 0;
    poll = setInterval(async () => {
      try {
        if (++ticks % 4 === 0) {
          await refresh();
          if (directory.open) renderDirectory();
        }
        await loadRoom();
      } catch (error) {
        if (error.status === 401) leave();
        else if (active !== "home") report(error);
      }
    },1000);
  }
  document.getElementById("logout").addEventListener("click",async () => {
    try { await voice.hangUp(); await api("logout",{}); leave(); }
    catch (error) { report(error); }
  });
  for (const [form,route] of [[signup,"signup"],[login,"login"]]) {
    form.addEventListener("submit",async event => {
      event.preventDefault();
      const submit = form.querySelector('[type="submit"]');
      const status = form.querySelector(".form-status");
      if (submit.disabled) return;
      submit.disabled = true;
      status.textContent = "";
      try { await api(route,Object.fromEntries(new FormData(form))); await enter(); form.reset(); }
      catch (error) { status.textContent = error.message; }
      finally { submit.disabled = false; }
    });
  }
  api("me").then(({user}) => user && enter()).catch(error => {
    login.querySelector(".form-status").textContent = error.message;
  });
})();
