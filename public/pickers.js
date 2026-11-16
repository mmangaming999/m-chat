"use strict";

function createMediaPickers(root, composer, selectGif) {
  const get = selector => root.querySelector(selector);
  const panel = get("[data-picker]");
  const searchForm = get("[data-picker-search]");
  const search = searchForm.querySelector("input");
  const categories = get("[data-picker-categories]");
  const results = get("[data-picker-results]");
  const status = get("[data-picker-status]");
  const footer = get("[data-picker-footer]");
  const more = get("[data-gif-more]");
  const credit = get("[data-giphy-credit]");
  const triggers = {
    emoji: get('[data-pick="emoji"]'),
    gif: get('[data-pick="gif"]'),
  };
  const emojiLabels = {
    "Smileys & Emotion": "Smileys", "People & Body": "People", "Animals & Nature": "Animals",
    "Food & Drink": "Food", "Travel & Places": "Travel", Activities: "Activities",
    Objects: "Objects", Symbols: "Symbols", Flags: "Flags", Component: "Components",
  };
  const gifLabels = {
    happy: "Happy", funny: "Funny", sad: "Sad", memes: "Memes", gaming: "Gaming",
    love: "Love", surprised: "Surprised", celebrate: "Celebrate",
  };
  const batchSize = 120;
  let emojiCatalog;
  let gifCatalog;
  let mediaConfig;
  let mode;
  let category;
  let emojiMatches = [];
  let shown = 0;
  let request;
  let page;

  async function json(path, options) {
    const timeout = AbortSignal.timeout(10_000);
    const signal = options?.signal ? AbortSignal.any([options.signal,timeout]) : timeout;
    const response = await fetch(path, { ...options, signal });
    if (!response.ok) throw new Error("Couldn’t load " + (path.startsWith("https:") ? "GIPHY" : "the picker"));
    return response.json();
  }
  function config() {
    mediaConfig ??= json("/api/media-config").catch(error => { mediaConfig = undefined; throw error; });
    return mediaConfig;
  }
  function makeButton(text, action) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = text;
    button.addEventListener("click",action);
    return button;
  }
  function close() {
    request?.abort();
    request = undefined;
    panel.hidden = true;
    for (const trigger of Object.values(triggers)) trigger.setAttribute("aria-expanded","false");
    mode = undefined;
  }
  function clearResults() {
    results.replaceChildren();
    results.scrollTop = 0;
    more.hidden = true;
    status.textContent = "";
  }
  function drawCategories(entries, select) {
    categories.replaceChildren(...entries.map(([key,label]) => {
      const button = makeButton(label,() => {
        category = key;
        search.value = "";
        for (const node of categories.children) node.setAttribute("aria-pressed",String(node === button));
        select();
      });
      button.setAttribute("aria-pressed",String(key === category));
      return button;
    }));
  }
  function appendEmoji() {
    const added = emojiMatches.slice(shown, shown + batchSize);
    for (const [character,name] of added) {
      const button = makeButton(character,() => {
        const start = composer.selectionStart ?? composer.value.length;
        const end = composer.selectionEnd ?? start;
        if (composer.value.length - (end - start) + character.length > composer.maxLength) return;
        composer.setRangeText(character,start,end,"end");
        composer.focus();
      });
      button.title = name;
      button.setAttribute("aria-label",name);
      results.append(button);
    }
    shown += added.length;
  }
  function drawEmoji(groups) {
    clearResults();
    const term = search.value.trim().toLowerCase();
    emojiMatches = term ? Object.values(groups).flat().filter(([character,name]) =>
      name.toLowerCase().includes(term) || character.includes(term)) : groups[category];
    shown = 0;
    appendEmoji();
    status.textContent = emojiMatches.length ? "" : "No matching emoji.";
  }
  const localUrl = id => "/gifs/" + id + ".gif";
  function safeGiphyUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && /^(?:[a-z0-9-]+\.)+giphy\.com$/i.test(url.hostname) ? value : null;
    } catch { return null; }
  }
  function gifGrid(label, showLabel) {
    const section = document.createElement("section");
    section.setAttribute("aria-label",label);
    if (showLabel) {
      const heading = document.createElement("h4");
      heading.textContent = label;
      section.append(heading);
    }
    const grid = document.createElement("div");
    grid.className = "gif-grid";
    section.append(grid);
    results.append(section);
    return grid;
  }
  function appendGif(grid,{id,title,url}) {
    const button = makeButton("",() => { selectGif({name:title,data:id,kind:"gif"}); close(); composer.focus(); });
    button.setAttribute("aria-label","Attach GIF: " + title);
    button.title = title;
    const image = document.createElement("img");
    image.src = url;
    image.loading = "lazy";
    image.alt = "";
    button.append(image);
    grid.append(button);
  }
  async function giphy(path, params, signal) {
    const {giphyKey} = await config();
    if (!giphyKey) return [];
    const query = new URLSearchParams({api_key:giphyKey,rating:"g",...params});
    const data = await json("https://api.giphy.com/v1/gifs" + path + "?" + query,{signal});
    return Array.isArray(data.data) ? data.data.filter(item => item.rating === "g") : [];
  }
  async function drawGifs(local, offset = 0) {
    request?.abort();
    request = new AbortController();
    const signal = request.signal;
    if (!offset) clearResults();
    const term = search.value.trim();
    const query = term || (category === "memes" ? "meme" : category);
    const localMatches = local.filter(item => term ?
      (item.title + " " + item.category + " " + item.id).toLowerCase().includes(term.toLowerCase()) :
      item.category === category);
    let localGrid;
    if (!offset && localMatches.length) {
      localGrid = gifGrid("Starter GIFs",false);
      localMatches.forEach(item => appendGif(localGrid,{...item,id:"local:" + item.id,url:localUrl(item.id)}));
    }
    more.disabled = true;
    try {
      const settings = await config();
      if (signal.aborted) return;
      credit.hidden = !settings.giphyKey;
      if (settings.giphyKey) credit.querySelector("img").src = "/giphy-attribution.png";
      if (!settings.giphyKey) {
        status.textContent = localMatches.length ? "" : "No matching GIFs in the starter pack.";
        return;
      }
      status.textContent = "Loading GIFs…";
      const response = await json("https://api.giphy.com/v1/gifs/search?" +
        new URLSearchParams({api_key:settings.giphyKey,q:query,rating:"g",limit:24,offset}),{signal});
      if (signal.aborted) return;
      const remote = (response.data ?? []).flatMap(item => {
        if (item.rating !== "g" || !/^[a-zA-Z0-9]{1,64}$/.test(item.id)) return [];
        const url = safeGiphyUrl(item.images?.fixed_width_small?.url ?? item.images?.fixed_width?.url);
        return url ? [{id:"giphy:" + item.id,title:item.title || "GIPHY reaction",url}] : [];
      });
      if (remote.length) {
        if (localGrid) {
          const heading = document.createElement("h4");
          heading.textContent = "Starter GIFs";
          localGrid.before(heading);
        }
        const grid = results.querySelector('[aria-label="GIPHY results"] .gif-grid') ?? gifGrid("GIPHY results",true);
        remote.forEach(item => appendGif(grid,item));
      }
      page = offset;
      const next = offset + 24;
      more.hidden = next >= Math.min(response.pagination?.total_count ?? 0,5000) || !response.data?.length;
      status.textContent = results.childElementCount ? "" : "No matching GIFs.";
    } catch (error) {
      if (!signal.aborted) status.textContent = "GIPHY is unavailable. Try a starter GIF.";
    } finally {
      if (!signal.aborted) more.disabled = false;
    }
  }
  async function open(next) {
    if (mode === next) { close(); return; }
    close();
    mode = next;
    category = next === "emoji" ? "Smileys & Emotion" : "happy";
    search.value = "";
    clearResults();
    categories.replaceChildren();
    panel.hidden = false;
    triggers[next].setAttribute("aria-expanded","true");
    footer.hidden = next !== "gif";
    credit.hidden = true;
    results.className = "picker-results " + next + "-results";
    search.placeholder = next === "gif" ? "Search GIFs and press Enter" : "Search emoji";
    searchForm.querySelector("button").hidden = next !== "gif";
    search.focus();
    try {
      if (next === "emoji") {
        emojiCatalog ??= await json("/emoji.json");
        if (mode !== next) return;
        drawCategories(Object.entries(emojiLabels).filter(([key]) => emojiCatalog.groups[key]),
          () => drawEmoji(emojiCatalog.groups));
        drawEmoji(emojiCatalog.groups);
      } else {
        gifCatalog ??= await json("/gifs.json");
        if (mode !== next) return;
        drawCategories(Object.entries(gifLabels),() => drawGifs(gifCatalog));
        await drawGifs(gifCatalog);
      }
    } catch (error) {
      if (mode === next) status.textContent = error.message;
    }
  }
  for (const [kind, trigger] of Object.entries(triggers)) trigger.addEventListener("click",() => open(kind));
  search.addEventListener("input",() => { if (mode === "emoji" && emojiCatalog) drawEmoji(emojiCatalog.groups); });
  searchForm.addEventListener("submit",event => {
    event.preventDefault();
    if (mode === "gif" && gifCatalog) drawGifs(gifCatalog);
  });
  more.addEventListener("click",() => { if (gifCatalog) drawGifs(gifCatalog,page + 24); });
  results.addEventListener("scroll",() => {
    if (mode === "emoji" && shown < emojiMatches.length &&
        results.scrollHeight - results.scrollTop - results.clientHeight < 80) appendEmoji();
  });
  document.addEventListener("click",event => {
    if (mode && !panel.contains(event.target) && !Object.values(triggers).some(trigger => trigger.contains(event.target))) close();
  });
  document.addEventListener("keydown",event => {
    if (mode && event.key === "Escape") {
      const trigger = triggers[mode];
      close();
      trigger.focus();
    }
  });
  async function resolveGifs(nodes) {
    const byId = new Map();
    for (const node of nodes) {
      const id = node.dataset.gif;
      if (!byId.has(id)) byId.set(id,[]);
      byId.get(id).push(node);
      node.dataset.loading = "true";
    }
    const ids = [...byId.keys()];
    for (let index = 0; index < ids.length; index += 24) {
      const batch = ids.slice(index,index + 24);
      const resolved = new Set();
      try {
        for (const item of await giphy("",{ids:batch.join(",")})) {
          const url = safeGiphyUrl(item.images?.fixed_width?.url ?? item.images?.downsized?.url);
          if (!url || !byId.has(item.id)) continue;
          resolved.add(item.id);
          for (const node of byId.get(item.id)) {
            const image = document.createElement("img");
            image.src = url;
            image.alt = item.title || "GIPHY reaction";
            image.className = "attachment";
            const attribution = document.createElement("img");
            attribution.src = "/giphy-attribution.png";
            attribution.alt = "Powered By GIPHY";
            attribution.className = "giphy-mark";
            node.replaceChildren(image,attribution);
          }
        }
      } catch { /* Keep the message available if GIPHY cannot be reached. */ }
      for (const id of batch) {
        for (const node of byId.get(id)) {
          if (!resolved.has(id)) node.textContent = "GIF unavailable";
        }
      }
    }
  }
  return {close,localUrl,resolveGifs,reset() { close(); mediaConfig = undefined; }};
}
