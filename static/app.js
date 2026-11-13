/* Organizer UI. Vanilla JS + FullCalendar (global bundle) + recurrence.js. */
(function () {
  "use strict";

  const R = window.Recurrence;
  const $ = (id) => document.getElementById(id);
  const WEEKDAYS = [[1, "Mon"], [2, "Tue"], [3, "Wed"], [4, "Thu"], [5, "Fri"], [6, "Sat"], [0, "Sun"]];
  const STATUSES = ["green", "yellow", "red"];
  // Palette keys (stored in the data); the colours themselves are CSS tokens --c-<key>.
  const COLORS = [["grey", "Grey"], ["cyan", "Cyan"], ["blue", "Blue"], ["indigo", "Indigo"],
                  ["lilac", "Lilac"], ["purple", "Purple"], ["magenta", "Magenta"],
                  ["green", "Green"], ["yellow", "Yellow"], ["red", "Red"]];
  // Block colours that look like a status: when not rated they show a hollow square.
  const STATUS_LIKE_COLORS = ["green", "yellow", "red"];
  const ACTIVITY_COLOR = "grey";   // default: no colour, the block takes the status colour
  const SERIES_COLOR = "lilac";

  let data = { activities: [], series: [], todos: [] };
  let calendar = null;

  /* ---------------------------------------------------------------- helpers */

  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }
  const pad = (n) => String(n).padStart(2, "0");
  function toLocal(d) {             // Date -> "YYYY-MM-DDTHH:MM" (local time)
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
      "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }
  function dateOf(d) { return toLocal(d).slice(0, 10); }
  function todayStr() { return dateOf(new Date()); }
  function plusMinutes(localStr, minutes) {
    const [date, time] = localStr.split("T");
    const [y, m, d] = date.split("-").map(Number);
    const [hh, mm] = time.split(":").map(Number);
    return toLocal(new Date(y, m - 1, d, hh, mm + minutes));
  }
  function statusClass(s) { return STATUSES.includes(s) ? "st-" + s : "st-none"; }
  /* Missing or unknown colour -> the default. */
  function colorKey(c, def) { return COLORS.some(([k]) => k === c) ? c : def; }
  /* null = no colour (whole block takes the status); otherwise the palette key. */
  function activityColor(a) {
    const c = colorKey(a && a.color, ACTIVITY_COLOR);
    return c === ACTIVITY_COLOR ? null : c;
  }
  function seriesColor(s) { return colorKey(s && s.color, SERIES_COLOR); }
  /* The default colour is stored as no field at all. */
  function setColorField(obj, c, def) {
    if (c === def) delete obj.color; else obj.color = c;
  }
  function statusSquare(s, color) {
    if (!STATUSES.includes(s)) {
      if (!STATUS_LIKE_COLORS.includes(color)) return null;
      const empty = el("span", "ev-sq sq-empty");
      empty.title = "Not rated";
      return empty;
    }
    const sq = el("span", "ev-sq sq-" + s);
    sq.title = { green: "100%", yellow: "50-99%", red: "< 50%" }[s];
    return sq;
  }
  function fmtDay(dateStr) {
    const d = R.parseDate(dateStr);
    return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  }
  function fmtRange(start, end) {
    let e = end.slice(11, 16);
    if (end.slice(0, 10) > start.slice(0, 10) && e === "00:00") e = "24:00";
    return start.slice(11, 16) + "–" + e;
  }
  function normTags(list) {
    const out = [];
    const seen = new Set();
    for (const raw of list || []) {
      const t = String(raw).trim().replace(/\s+/g, " ");
      if (t && !seen.has(t.toLowerCase())) { seen.add(t.toLowerCase()); out.push(t); }
    }
    return out;
  }
  function allTags() {
    const all = [];
    for (const a of data.activities) all.push(...(a.tags || []));
    for (const t of data.todos) all.push(...(t.tags || []));
    for (const s of data.series) {
      all.push(...(s.tags || []));
      for (const ex of Object.values(s.exceptions || {})) all.push(...(ex.tags || []));
    }
    return normTags(all).sort((a, b) => a.localeCompare(b));
  }
  /* To-do topic: "" means Generic. Stored as no field, never as "Generic". */
  const GENERIC = "Generic";
  function normTopic(raw) {
    const t = String(raw == null ? "" : raw).trim().replace(/\s+/g, " ");
    return t.toLowerCase() === GENERIC.toLowerCase() ? "" : t;
  }
  function topicOf(todo) { return normTopic(todo && todo.topic); }
  function setTopicField(obj, raw) {
    const t = normTopic(raw);
    if (t) obj.topic = t; else delete obj.topic;
  }
  /* Suggestions for the Topic inputs: topics already used, plus every tag. */
  function allTopics() {
    return normTags(data.todos.map(topicOf).concat(allTags())).filter((t) => normTopic(t))
      .sort((a, b) => a.localeCompare(b));
  }
  /* The activity a to-do becomes when dropped: a non-Generic topic is added as a tag. */
  function todoToActivity(todo, start) {
    const topic = topicOf(todo);
    return {
      id: uid(), title: todo.title, description: todo.description || "", results: "",
      tags: normTags((todo.tags || []).concat(topic ? [topic] : [])), status: null,
      start, end: plusMinutes(start, 60),
    };
  }
  /* Groups for the panel: alphabetical (case-insensitive), Generic last, list order kept inside. */
  function groupTodos(todos) {
    const groups = new Map();
    for (const t of todos) {
      const topic = topicOf(t);
      const key = topic.toLowerCase();
      if (!groups.has(key)) groups.set(key, { topic, items: [] });
      groups.get(key).items.push(t);
    }
    return [...groups.values()].sort((a, b) => {
      if (!a.topic !== !b.topic) return a.topic ? -1 : 1;
      return a.topic.localeCompare(b.topic, undefined, { sensitivity: "base" });
    });
  }
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  let toastTimer = null;
  function toast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
  }
  const findActivity = (id) => data.activities.find((a) => a.id === id);
  const findSeries = (id) => data.series.find((s) => s.id === id);
  const findTodo = (id) => data.todos.find((t) => t.id === id);
  function replaceSeries(s) {
    data.series = data.series.map((x) => (x.id === s.id ? s : x));
  }

  /* ------------------------------------------------------------ persistence */

  let saving = false;
  let dirty = false;

  function setSaveState(text, isError) {
    const s = $("save-state");
    s.textContent = text;
    s.classList.toggle("error", !!isError);
    s.title = isError ? "Click to retry" : "";
  }

  async function load() {
    const res = await fetch("/api/data", { cache: "no-store" });
    if (!res.ok) throw new Error("GET /api/data " + res.status);
    const doc = await res.json();
    // unknown top-level keys are kept, so a save never drops them
    data = Object.assign({}, doc, {
      activities: Array.isArray(doc.activities) ? doc.activities : [],
      series: Array.isArray(doc.series) ? doc.series : [],
      todos: Array.isArray(doc.todos) ? doc.todos : [],
    });
  }

  /* Every change goes through here: save the whole document, then redraw. */
  function changed() {
    dirty = true;
    refreshAll();
    if (!saving) flush();
  }

  async function flush() {
    saving = true;
    setSaveState("Saving…");
    while (dirty) {
      dirty = false;
      try {
        const res = await fetch("/api/data", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
        if (!res.ok) throw new Error("PUT " + res.status + " " + (await res.text()));
      } catch (err) {
        dirty = true;
        saving = false;
        setSaveState("Not saved", true);
        console.error(err);
        return false;
      }
    }
    saving = false;
    setSaveState("Saved");
    return true;
  }

  async function waitForSave() {
    for (let i = 0; i < 50 && saving; i++) await new Promise((r) => setTimeout(r, 100));
    if (dirty) return flush();
    return true;
  }

  /* --------------------------------------------------------------- calendar */

  function buildEvents(rangeStartDate, rangeEndDate) {
    const lo = dateOf(rangeStartDate);
    const hi = dateOf(rangeEndDate);
    const loB = lo + "T00:00";
    const hiB = hi + "T00:00";
    const events = [];
    for (const a of data.activities) {
      if (!(a.end > loB && a.start < hiB)) continue;
      events.push({
        id: a.id, title: a.title, start: a.start, end: a.end,
        extendedProps: { kind: "activity", ref: a.id, description: a.description, status: a.status,
                         color: activityColor(a), tags: a.tags || [] },
      });
    }
    for (const o of R.expandAll(data.series, lo, hi)) {
      events.push({
        id: o.id, title: o.title, start: o.start, end: o.end,
        extendedProps: { kind: "occurrence", seriesId: o.seriesId, date: o.date,
                         description: o.description, status: o.status,
                         color: seriesColor(findSeries(o.seriesId)), tags: o.tags || [] },
      });
    }
    return events;
  }

  function renderEvent(arg) {
    const p = arg.event.extendedProps || {};
    // no colour: the whole block takes the status; with a colour: status is a square
    const box = el("div", "ev " + (p.color ? "colored col-" + p.color : statusClass(p.status)) +
                          (p.kind === "occurrence" ? " recurring" : ""));
    const top = el("div", "ev-top");
    top.appendChild(el("span", "ev-title", arg.event.title || ""));
    if (p.kind === "occurrence") {
      const icon = el("span", "ev-icon", "↻");
      icon.title = "Recurring";
      top.appendChild(icon);
    }
    const sq = p.color ? statusSquare(p.status, p.color) : null;
    if (sq) top.appendChild(sq);
    box.appendChild(top);
    if (arg.timeText) box.appendChild(el("div", "ev-time", arg.timeText));
    if (p.description) box.appendChild(el("div", "ev-desc", p.description));
    const tags = normTags(p.tags);
    if (tags.length) {
      // pinned to the bottom of the block; fitBlock shows it only where there is room
      const tg = el("div", "ev-tags");
      for (const t of tags) {
        const chip = el("span", "ev-tag", t);
        chip.title = t;
        tg.appendChild(chip);
      }
      box.appendChild(tg);
    }
    box.title = (arg.event.title || "") + (p.description ? "\n\n" + p.description : "");
    // fit after every render: FullCalendar can redraw the content without a new mount
    requestAnimationFrame(() => fitBlock(box));
    return { domNodes: [box] };
  }

  /* Fit the block to its height. Priority: title, time, one row of tags, description
     (whole lines only), then more tag rows in what is left. */
  const LINE_H = 16;          /* .ev line-height */
  const TAG_ROW_H = 14;       /* .ev-tag height */
  const TAG_GAP = 2;          /* .ev-tags gap */
  function fitBlock(box) {
    if (!box.isConnected) return;
    const bottom = box.getBoundingClientRect().bottom - 2;   // minus the bottom padding
    const desc = box.querySelector(".ev-desc");
    const hasTags = !!box.querySelector(".ev-tags");
    if (desc) {
      desc.style.display = "";
      desc.style.webkitLineClamp = "";
      if (getComputedStyle(desc).display !== "none") {
        const top = desc.getBoundingClientRect().top;
        // keep one tag row free below the description, when one fits at all
        const reserve = hasTags && bottom - top >= TAG_ROW_H + 3 ? TAG_ROW_H + 3 : 0;
        const lines = Math.floor((bottom - reserve - top) / LINE_H);
        if (lines < 1) desc.style.display = "none";
        else desc.style.webkitLineClamp = String(lines);
      }
    }
    const tags = box.querySelector(".ev-tags");
    if (!tags) return;
    tags.classList.remove("fits", "inline");
    tags.style.maxHeight = tags.style.top = tags.style.left = tags.style.bottom = "";
    let used = -Infinity;
    for (const c of box.children) {
      if (c === tags || getComputedStyle(c).display === "none") continue;
      used = Math.max(used, c.getBoundingClientRect().bottom);
    }
    const rows = Math.floor((bottom - used - 3 + TAG_GAP) / (TAG_ROW_H + TAG_GAP));   // 3px above the tags
    if (rows < 1) { fitTagsInline(box, tags); return; }
    tags.style.maxHeight = (rows * (TAG_ROW_H + TAG_GAP) - TAG_GAP) + "px";
    tags.classList.add("fits");
  }

  /* No room for a tag row at the bottom: put the tags on the time line, right of the time. */
  function fitTagsInline(box, tags) {
    const time = box.querySelector(".ev-time");
    if (!time || getComputedStyle(time).display === "none") return;
    const br = box.getBoundingClientRect();
    const tr = time.getBoundingClientRect();
    if (tr.bottom > br.bottom) return;
    const range = document.createRange();
    range.selectNodeContents(time);
    const left = tr.left - br.left + range.getBoundingClientRect().width + 6;
    if (br.width - left - 6 < 24) return;
    tags.style.top = (tr.top - br.top + 1) + "px";
    tags.style.left = left + "px";
    tags.style.bottom = "auto";
    tags.style.maxHeight = TAG_ROW_H + "px";
    tags.classList.add("fits", "inline");
  }

  /* Re-fit whenever a block changes size (window resize, panel resize, expandRows). */
  const blockObserver = window.ResizeObserver
    ? new ResizeObserver((entries) => {
        for (const e of entries) {
          const box = e.target.querySelector(".ev");
          if (box) fitBlock(box);
        }
      })
    : null;
  function onEventMount(info) { if (blockObserver) blockObserver.observe(info.el); }
  function onEventUnmount(info) { if (blockObserver) blockObserver.unobserve(info.el); }

  function eventTimes(ev) {
    const start = toLocal(ev.start);
    const end = ev.end ? toLocal(ev.end) : plusMinutes(start, 60);
    return { start, end };
  }

  function onMoveOrResize(info) {
    const p = info.event.extendedProps;
    const { start, end } = eventTimes(info.event);
    if (p.kind === "activity") {
      const a = findActivity(p.ref);
      if (!a) return info.revert();
      a.start = start;
      a.end = end;
    } else if (p.kind === "occurrence") {
      const s = findSeries(p.seriesId);
      if (!s) return info.revert();
      // indexed by the ORIGINAL date, whatever the new date is
      replaceSeries(R.withException(s, p.date, { start, end }));
    }
    changed();
  }

  function onReceiveTodo(info) {
    const p = info.event.extendedProps;
    const todo = findTodo(p.todoId);
    info.event.remove();
    if (!todo) return;
    data.activities.push(todoToActivity(todo, toLocal(info.event.start)));
    data.todos = data.todos.filter((t) => t.id !== todo.id);
    changed();
  }

  function openFromEventProps(p) {
    if (p.kind === "activity") return openEditor({ mode: "activity", id: p.ref });
    if (p.kind === "occurrence") {
      return askScope().then((scope) => {
        if (scope === "one") openEditor({ mode: "occurrence", seriesId: p.seriesId, date: p.date });
        else if (scope === "series") openEditor({ mode: "series", seriesId: p.seriesId });
      });
    }
  }

  function initCalendar() {
    const hourFmt = { hour: "2-digit", minute: "2-digit", hour12: false };
    const now = new Date();
    calendar = new FullCalendar.Calendar($("calendar"), {
      initialView: "timeGridWeek",
      firstDay: 1,
      slotMinTime: "07:00:00",
      slotMaxTime: "24:00:00",
      slotDuration: "00:30:00",
      snapDuration: "00:15:00",
      scrollTime: pad(Math.min(20, Math.max(7, now.getHours() - 1))) + ":00:00",
      allDaySlot: false,
      nowIndicator: true,
      height: "100%",
      expandRows: true,
      slotLabelFormat: hourFmt,
      eventTimeFormat: hourFmt,
      dayHeaderFormat: { weekday: "short", day: "numeric", month: "numeric", omitCommas: true },
      headerToolbar: { left: "prev,next today", center: "title", right: "" },
      editable: true,
      selectable: true,
      selectMirror: true,
      droppable: true,
      eventDurationEditable: true,
      events: (info, ok) => ok(buildEvents(info.start, info.end)),
      eventContent: renderEvent,
      eventDidMount: onEventMount,
      eventWillUnmount: onEventUnmount,
      eventClick: (info) => { info.jsEvent.preventDefault(); openFromEventProps(info.event.extendedProps); },
      select: (info) => {
        calendar.unselect();
        openEditor({ mode: "activity", isNew: true, start: toLocal(info.start), end: toLocal(info.end) });
      },
      eventDrop: onMoveOrResize,
      eventResize: onMoveOrResize,
      eventReceive: onReceiveTodo,
    });
    calendar.render();

    new FullCalendar.Draggable($("todo-list"), {
      itemSelector: ".todo",
      eventData: (item) => ({
        title: item.dataset.title,
        duration: "01:00",
        create: true,
        extendedProps: { kind: "todo", todoId: item.dataset.id },
      }),
    });
  }

  /* ------------------------------------------------------------------ chips */

  function Chips(container, input, onChange) {
    let tags = [];
    const render = () => {
      container.querySelectorAll(".chip").forEach((c) => c.remove());
      for (const t of tags) {
        const chip = el("span", "chip");
        chip.appendChild(el("span", "", t));
        const x = el("button", "", "×");
        x.type = "button";
        x.title = "Remove";
        x.addEventListener("click", () => { tags = tags.filter((y) => y !== t); render(); onChange && onChange(); });
        chip.appendChild(x);
        container.insertBefore(chip, input);
      }
    };
    const commit = () => {
      const v = input.value.replace(/,/g, " ").trim();
      input.value = "";
      if (!v) return false;
      tags = normTags(tags.concat([v]));
      render();
      onChange && onChange();
      return true;
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === ",") {
        e.preventDefault();
        commit();
      } else if (e.key === "Backspace" && !input.value && tags.length) {
        tags.pop();
        render();
        onChange && onChange();
      }
    });
    input.addEventListener("input", (e) => {
      // picking a suggestion from the datalist adds it straight away
      if (!e.inputType || e.inputType === "insertReplacementText") {
        if (allTags().some((t) => t.toLowerCase() === input.value.trim().toLowerCase())) commit();
      }
    });
    container.addEventListener("click", (e) => { if (e.target === container) input.focus(); });
    return {
      get: () => { commit(); return tags.slice(); },
      peek: () => tags.slice(),
      set: (list) => { tags = normTags(list); input.value = ""; render(); },
    };
  }

  /* ----------------------------------------------------------------- editor */

  const editor = $("editor");
  const form = $("editor-form");
  let ed = null;            // what the editor is editing
  let editorTags = null;
  let editorStatus = null;
  let editorColor = ACTIVITY_COLOR;

  function timeOptions(select, includeEnd) {
    select.innerHTML = "";
    const last = includeEnd ? 24 * 60 : 24 * 60 - 15;
    for (let m = 0; m <= last; m += 15) {
      const v = pad(Math.floor(m / 60)) + ":" + pad(m % 60);
      select.appendChild(new Option(v, v));
    }
  }
  function setTime(select, v) {
    if (![...select.options].some((o) => o.value === v)) select.appendChild(new Option(v, v));
    select.value = v;
  }
  function endTimeOf(start, end) {
    const t = end.slice(11, 16);
    return end.slice(0, 10) > start.slice(0, 10) && t === "00:00" ? "24:00" : t;
  }
  function combine(date, st, et) {
    const start = date + "T" + st;
    let end;
    if (et === "24:00") end = R.addDays(date, 1) + "T00:00";
    else if (et <= st) end = R.addDays(date, 1) + "T" + et;
    else end = date + "T" + et;
    return { start, end };
  }

  function buildWeekdayPicker() {
    const box = $("f-weekdays");
    box.innerHTML = "";
    for (const [n, name] of WEEKDAYS) {
      const lab = el("label");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.value = String(n);
      cb.addEventListener("change", () => lab.classList.toggle("on", cb.checked));
      lab.appendChild(cb);
      lab.appendChild(document.createTextNode(name));
      box.appendChild(lab);
    }
  }
  function setWeekdays(list) {
    $("f-weekdays").querySelectorAll("input").forEach((cb) => {
      cb.checked = list.includes(Number(cb.value));
      cb.parentElement.classList.toggle("on", cb.checked);
    });
  }
  function getWeekdays() {
    return [...$("f-weekdays").querySelectorAll("input:checked")].map((cb) => Number(cb.value)).sort();
  }

  function setStatus(s) {
    editorStatus = STATUSES.includes(s) ? s : null;
    $("f-status").querySelectorAll(".st").forEach((b) => {
      b.classList.toggle("selected", (b.dataset.status || null) === editorStatus);
    });
  }

  function buildColorPicker() {
    const box = $("f-color");
    box.innerHTML = "";
    for (const [key, name] of COLORS) {
      const b = el("button", "sw col-" + key);
      b.type = "button";
      b.dataset.color = key;
      b.title = name;
      b.setAttribute("role", "radio");
      b.setAttribute("aria-label", name);
      box.appendChild(b);
    }
  }
  function setColor(c) {
    editorColor = c;
    $("f-color").querySelectorAll(".sw").forEach((b) => {
      const on = b.dataset.color === c;
      b.classList.toggle("selected", on);
      b.setAttribute("aria-checked", on ? "true" : "false");
    });
  }

  function applyModeVisibility() {
    editor.querySelectorAll("[data-only]").forEach((node) => {
      node.hidden = !node.dataset.only.split(" ").includes(ed.mode);
    });
    if (ed.mode === "activity" && !$("f-repeat").checked) $("repeat-box").hidden = true;
    $("btn-delete").hidden = !!ed.isNew;
    $("btn-reschedule").hidden = ed.mode === "todo" || ed.mode === "series";
  }

  function openEditor(target) {
    ed = Object.assign({}, target);
    form.reset();
    let v = { title: "", description: "", results: "", tags: [], status: null };
    let kind = "";
    let color = ACTIVITY_COLOR;

    if (ed.mode === "activity") {
      const a = ed.isNew ? { start: ed.start, end: ed.end } : findActivity(ed.id);
      if (!a) return;
      v = Object.assign(v, a);
      $("f-date").value = a.start.slice(0, 10);
      setTime($("f-start"), a.start.slice(11, 16));
      setTime($("f-end"), endTimeOf(a.start, a.end));
      setWeekdays([R.weekday(a.start.slice(0, 10))]);
      $("f-until").value = "";
      color = activityColor(a) || ACTIVITY_COLOR;
      kind = ed.isNew ? "New activity" : "Activity";
    } else if (ed.mode === "occurrence") {
      const s = findSeries(ed.seriesId);
      const o = s && R.occurrence(s, ed.date);
      if (!o) return;
      v = Object.assign(v, o);
      $("f-date").value = o.start.slice(0, 10);
      setTime($("f-start"), o.start.slice(11, 16));
      setTime($("f-end"), endTimeOf(o.start, o.end));
      kind = "Only this occurrence · " + fmtDay(ed.date);
    } else if (ed.mode === "series") {
      const s = findSeries(ed.seriesId);
      if (!s) return;
      v = Object.assign(v, s);
      setTime($("f-start"), s.startTime);
      setTime($("f-end"), s.endTime);
      setWeekdays(s.weekdays || []);
      $("f-from").value = s.from;
      $("f-until").value = s.until || "";
      color = seriesColor(s);
      kind = "Whole series";
    } else if (ed.mode === "todo") {
      const t = findTodo(ed.id);
      if (!t) return;
      v = Object.assign(v, t);
      $("f-topic").value = topicOf(t);
      kind = "To-do";
    }

    $("editor-kind").textContent = kind;
    $("f-title").value = v.title || "";
    $("f-description").value = v.description || "";
    $("f-results").value = v.results || "";
    editorTags.set(v.tags || []);
    setStatus(v.status);
    setColor(color);
    applyModeVisibility();
    if (!editor.open) editor.showModal();
    if (ed.isNew) $("f-title").focus();
  }

  function closeEditor() {
    if (editor.open) editor.close();
    ed = null;
  }

  function readForm() {
    const date = $("f-date").value;
    const st = $("f-start").value;
    const et = $("f-end").value;
    return {
      title: $("f-title").value.trim(),
      description: $("f-description").value.replace(/\s+$/, ""),
      results: $("f-results").value.replace(/\s+$/, ""),
      tags: editorTags.get(),
      status: editorStatus,
      color: editorColor,
      date, st, et,
      repeat: $("f-repeat").checked,
      weekdays: getWeekdays(),
      from: $("f-from").value,
      until: $("f-until").value || null,
    };
  }

  function saveEditor() {
    if (!ed) return;
    const f = readForm();
    if (!f.title) { $("f-title").focus(); toast("Title is empty"); return; }

    if (ed.mode === "activity") {
      if (!f.date) return toast("Pick a date");
      const { start, end } = combine(f.date, f.st, f.et);
      if (f.repeat) {
        if (!f.weekdays.length) return toast("Pick at least one weekday");
        if (f.until && f.until < f.date) return toast("Until is before the start date");
        let s = {
          id: uid(), title: f.title, description: f.description, tags: f.tags,
          weekdays: f.weekdays, startTime: f.st, endTime: f.et, from: f.date, until: f.until,
          exceptions: {},
        };
        // grey (no colour chosen) gives the series default, any other colour carries over
        setColorField(s, f.color === ACTIVITY_COLOR ? SERIES_COLOR : f.color, SERIES_COLOR);
        if ((f.results || f.status) && R.isOccurrenceDate(s, f.date)) {
          s = R.withException(s, f.date, { results: f.results, status: f.status });
        }
        data.series.push(s);
        if (!ed.isNew) data.activities = data.activities.filter((a) => a.id !== ed.id);
      } else {
        const fields = { title: f.title, description: f.description, results: f.results,
                         tags: f.tags, status: f.status, start, end };
        const a = ed.isNew ? Object.assign({ id: uid() }, fields) : Object.assign(findActivity(ed.id), fields);
        setColorField(a, f.color, ACTIVITY_COLOR);
        if (ed.isNew) data.activities.push(a);
      }
    } else if (ed.mode === "occurrence") {
      const s = findSeries(ed.seriesId);
      const { start, end } = combine(f.date, f.st, f.et);
      replaceSeries(R.withException(s, ed.date, {
        title: f.title, description: f.description, results: f.results,
        tags: f.tags, status: f.status, start, end,
      }));
    } else if (ed.mode === "series") {
      if (!f.weekdays.length) return toast("Pick at least one weekday");
      if (!f.from) return toast("Pick a From date");
      if (f.until && f.until < f.from) return toast("Until is before From");
      const s = findSeries(ed.seriesId);
      // exceptions are left untouched: those outside the new range are only hidden
      Object.assign(s, { title: f.title, description: f.description, tags: f.tags,
                         weekdays: f.weekdays, startTime: f.st, endTime: f.et,
                         from: f.from, until: f.until });
      setColorField(s, f.color, SERIES_COLOR);
    } else if (ed.mode === "todo") {
      // to-dos have no Tags field: tags already in the data are kept as they are
      const t = Object.assign(findTodo(ed.id), { title: f.title, description: f.description });
      setTopicField(t, $("f-topic").value);
    }
    closeEditor();
    changed();
  }

  function deleteFromEditor() {
    if (!ed || ed.isNew) return;
    if (ed.mode === "activity") {
      if (!confirm("Delete this activity?")) return;
      data.activities = data.activities.filter((a) => a.id !== ed.id);
    } else if (ed.mode === "occurrence") {
      if (!confirm("Delete only this occurrence?")) return;
      replaceSeries(R.withException(findSeries(ed.seriesId), ed.date, { cancelled: true }));
    } else if (ed.mode === "series") {
      if (!confirm("Delete the whole series, with every occurrence and its results?")) return;
      data.series = data.series.filter((s) => s.id !== ed.seriesId);
    } else if (ed.mode === "todo") {
      data.todos = data.todos.filter((t) => t.id !== ed.id);
    }
    closeEditor();
    changed();
  }

  /* The block keeps showing the plan: reschedule only adds a to-do. */
  function rescheduleFromEditor() {
    const f = readForm();
    const todo = {
      id: uid(), title: f.title || "Untitled", description: f.description,
      tags: f.tags, created: toLocal(new Date()),
    };
    // Generic, unless the activity has exactly one tag: that tag becomes the topic
    if (f.tags.length === 1) setTopicField(todo, f.tags[0]);
    data.todos.unshift(todo);
    showTodoPanel(true);
    changed();
    toast("Added to the to-do list");
  }

  function askScope() {
    const dlg = $("scope-dialog");
    return new Promise((resolve) => {
      dlg.returnValue = "cancel";
      dlg.addEventListener("close", () => resolve(dlg.returnValue || "cancel"), { once: true });
      dlg.showModal();
    });
  }

  function initEditor() {
    timeOptions($("f-start"), false);
    timeOptions($("f-end"), true);
    buildWeekdayPicker();
    buildColorPicker();
    editorTags = Chips($("f-tags"), $("f-tag-input"));
    $("f-color").addEventListener("click", (e) => {
      const b = e.target.closest(".sw");
      if (b) setColor(b.dataset.color);
    });
    $("f-status").addEventListener("click", (e) => {
      const b = e.target.closest(".st");
      if (b) setStatus(b.dataset.status || null);
    });
    $("f-repeat").addEventListener("change", () => {
      if (ed) applyModeVisibility();
      $("repeat-box").hidden = !$("f-repeat").checked;
    });
    $("f-start").addEventListener("change", () => {
      // keep the duration sensible: end never before start
      if ($("f-end").value <= $("f-start").value && $("f-end").value !== "24:00") {
        const [h, m] = $("f-start").value.split(":").map(Number);
        const t = Math.min(24 * 60, h * 60 + m + 60);
        setTime($("f-end"), pad(Math.floor(t / 60)) + ":" + pad(t % 60));
      }
    });
    form.addEventListener("submit", (e) => { e.preventDefault(); saveEditor(); });
    form.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveEditor(); }
    });
    form.addEventListener("click", (e) => {
      const b = e.target.closest("[data-action]");
      if (!b) return;
      const a = b.dataset.action;
      if (a === "cancel") closeEditor();
      else if (a === "delete") deleteFromEditor();
      else if (a === "reschedule") rescheduleFromEditor();
    });
    editor.addEventListener("close", () => { ed = null; });
  }

  /* ------------------------------------------------------------------ to-do */

  function todoItem(t) {
    const li = el("li", "todo");
    li.dataset.id = t.id;
    li.dataset.title = t.title;
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.title = "Done: remove it";
    cb.addEventListener("change", () => {
      data.todos = data.todos.filter((x) => x.id !== t.id);
      changed();
    });
    const body = el("div", "todo-body");
    // the group header already names the topic: only the task is shown
    body.appendChild(el("div", "todo-title", t.title));
    if (t.description) body.appendChild(el("div", "todo-desc", t.description));
    body.title = t.title + (t.description ? "\n\n" + t.description : "");
    body.addEventListener("click", () => openEditor({ mode: "todo", id: t.id }));
    li.appendChild(cb);
    li.appendChild(body);
    return li;
  }

  function renderTodos() {
    const list = $("todo-list");
    list.innerHTML = "";
    if (!data.todos.length) {
      list.appendChild(el("li", "todo-empty", "Nothing to reschedule."));
      return;
    }
    for (const g of groupTodos(data.todos)) {
      list.appendChild(el("li", "todo-group", g.topic || GENERIC));
      for (const t of g.items) list.appendChild(todoItem(t));
    }
  }

  /* Panel width: a per-viewer convenience in localStorage, never in the data file. */
  const PANEL_MIN = 280;        // the default width is also the minimum
  const CALENDAR_MIN = 480;     // what is left to the calendar view never goes below this
  const WIDTH_KEY = "organizer.todoWidth";
  let panelWidth = null;        // null = the default width from style.css

  function clampPanelWidth(w) {
    const layout = document.querySelector(".layout").getBoundingClientRect().width;
    const handle = $("todo-resizer").getBoundingClientRect().width;
    const max = Math.max(PANEL_MIN, layout - handle - CALENDAR_MIN);
    return Math.round(Math.min(max, Math.max(PANEL_MIN, w)));
  }
  function applyPanelWidth() {
    $("todo-panel").style.width = panelWidth == null ? "" : clampPanelWidth(panelWidth) + "px";
  }

  function initResizer() {
    const handle = $("todo-resizer");
    try {
      const v = parseInt(localStorage.getItem(WIDTH_KEY), 10);
      if (v > 0) panelWidth = v;
    } catch (e) { /* ignore */ }
    let frame = 0;
    const relayout = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => { frame = 0; if (calendar) calendar.updateSize(); });
    };
    handle.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      try { handle.setPointerCapture(e.pointerId); } catch (err) { /* window listeners below suffice */ }
      handle.classList.add("active");
      document.body.classList.add("resizing");
      // relative to where the drag started, so the edge does not jump under the pointer
      const startX = e.clientX;
      const startW = $("todo-panel").getBoundingClientRect().width;
      let moved = false;
      const move = (ev) => {
        moved = true;
        panelWidth = clampPanelWidth(startW + startX - ev.clientX);
        applyPanelWidth();
        relayout();
      };
      const end = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", end);
        window.removeEventListener("pointercancel", end);
        handle.classList.remove("active");
        document.body.classList.remove("resizing");
        if (!moved) return;
        try { localStorage.setItem(WIDTH_KEY, String(panelWidth)); } catch (err) { /* ignore */ }
        if (calendar) calendar.updateSize();
      };
      // on window, not only the handle: the pointer leaves it as soon as the drag starts
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", end);
      window.addEventListener("pointercancel", end);
    });
    handle.addEventListener("dblclick", () => {
      panelWidth = null;
      try { localStorage.removeItem(WIDTH_KEY); } catch (e) { /* ignore */ }
      applyPanelWidth();
      if (calendar) calendar.updateSize();
    });
    window.addEventListener("resize", applyPanelWidth);
  }

  function showTodoPanel(show) {
    $("todo-panel").hidden = !show;
    $("todo-resizer").hidden = !show;
    $("toggle-todos").classList.toggle("on", show);
    try { localStorage.setItem("organizer.todos", show ? "1" : "0"); } catch (e) { /* ignore */ }
    if (show) applyPanelWidth();
    if (calendar) setTimeout(() => calendar.updateSize(), 0);
  }

  /* Quick add: the Task clears, the Topic stays, so several tasks go in one after another. */
  function addTodoFromPanel() {
    const title = $("todo-title").value.trim();
    if (!title) return;
    const todo = { id: uid(), title, description: "", tags: [], created: toLocal(new Date()) };
    setTopicField(todo, $("todo-topic").value);
    data.todos.unshift(todo);
    $("todo-title").value = "";
    changed();
  }

  function initTodos() {
    $("todo-add").addEventListener("submit", (e) => { e.preventDefault(); addTodoFromPanel(); });
    // two text inputs and no submit button: Enter does not submit the form by itself
    $("todo-title").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); addTodoFromPanel(); }
    });
    $("todo-topic").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.isComposing) $("todo-title").focus();
    });
    $("toggle-todos").addEventListener("click", () => showTodoPanel($("todo-panel").hidden));
    initResizer();
    let open = false;
    try { open = localStorage.getItem("organizer.todos") === "1"; } catch (e) { /* ignore */ }
    showTodoPanel(open);
  }

  /* ----------------------------------------------------------------- filter */

  let filterTags = null;

  function filterItems() {
    const before = Math.max(0, parseInt($("win-before").value, 10) || 0);
    const after = Math.max(0, parseInt($("win-after").value, 10) || 0);
    const today = todayStr();
    const lo = R.addDays(today, -before);
    const hi = R.addDays(today, after + 1);
    const loB = lo + "T00:00";
    const hiB = hi + "T00:00";
    let items = [];
    for (const a of data.activities) {
      if (a.start >= loB && a.start < hiB) {
        items.push({ kind: "activity", ref: a.id, start: a.start, end: a.end, title: a.title,
                     description: a.description, results: a.results, status: a.status, tags: a.tags || [],
                     color: activityColor(a) });
      }
    }
    if ($("include-recurring").checked) {
      for (const o of R.expandAll(data.series, lo, hi)) {
        if (o.start >= loB && o.start < hiB) {
          items.push(Object.assign({ kind: "occurrence", color: seriesColor(findSeries(o.seriesId)) }, o));
        }
      }
    }
    const wanted = filterTags.peek().map((t) => t.toLowerCase());
    if (wanted.length) {
      items = items.filter((it) => (it.tags || []).some((t) => wanted.includes(t.toLowerCase())));
    }
    return items.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  }

  function renderFilter() {
    if ($("view-filter").hidden) return;
    const box = $("filter-results");
    box.innerHTML = "";
    const show = { title: $("show-title").checked, description: $("show-description").checked,
                   results: $("show-results").checked };
    const items = filterItems();
    const now = toLocal(new Date());
    const todayLine = el("div", "today-line", "Today · " + fmtDay(todayStr()) + " " + now.slice(11, 16));
    let lineDone = false;
    if (!items.length) {
      box.appendChild(todayLine);
      box.appendChild(el("div", "fr-empty", "Nothing in this window."));
      return;
    }
    for (const it of items) {
      if (!lineDone && it.start >= now) { box.appendChild(todayLine); lineDone = true; }
      const row = el("div", "fr-item " + (it.color ? "colored col-" + it.color : statusClass(it.status)) +
                            (it.start < now ? " past" : ""));
      const when = el("div", "fr-when");
      when.appendChild(el("b", "", fmtDay(it.start.slice(0, 10))));
      when.appendChild(document.createTextNode(fmtRange(it.start, it.end) + (it.kind === "occurrence" ? "  ↻" : "")));
      const sq = it.color ? statusSquare(it.status, it.color) : null;
      if (sq) when.appendChild(sq);
      const main = el("div", "fr-main");
      if (show.title) main.appendChild(el("div", "fr-title", it.title || "Untitled"));
      for (const k of ["description", "results"]) {
        if (show[k] && it[k]) {
          const t = el("div", "fr-text");
          t.appendChild(el("span", "k", k));
          t.appendChild(document.createTextNode(it[k]));
          main.appendChild(t);
        }
      }
      if (it.tags && it.tags.length) {
        const tg = el("div", "fr-tags");
        for (const x of it.tags) tg.appendChild(el("span", "tag", x));
        main.appendChild(tg);
      }
      row.appendChild(when);
      row.appendChild(main);
      row.addEventListener("click", () => openFromEventProps(
        it.kind === "activity" ? { kind: "activity", ref: it.ref }
                               : { kind: "occurrence", seriesId: it.seriesId, date: it.date }));
      box.appendChild(row);
    }
    if (!lineDone) box.appendChild(todayLine);
  }

  function initFilter() {
    filterTags = Chips($("filter-tags"), $("filter-tag-input"), renderFilter);
    for (const id of ["show-title", "show-description", "show-results", "include-recurring", "win-before", "win-after"]) {
      $(id).addEventListener("input", renderFilter);
      $(id).addEventListener("change", renderFilter);
    }
  }

  /* ------------------------------------------------------------ view, power */

  function setView(name) {
    document.querySelectorAll(".view-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
    $("view-calendar").hidden = name !== "calendar";
    $("view-filter").hidden = name !== "filter";
    if (name === "calendar") calendar.updateSize();
    else renderFilter();
  }

  function refreshDatalist() {
    const dl = $("tag-list");
    dl.innerHTML = "";
    for (const t of allTags()) dl.appendChild(new Option(t, t));
    const tl = $("topic-list");
    tl.innerHTML = "";
    for (const t of allTopics()) tl.appendChild(new Option(t, t));
  }

  function refreshAll() {
    if (calendar) calendar.refetchEvents();
    renderTodos();
    renderFilter();
    refreshDatalist();
  }

  function showOff(title, text) {
    const off = $("off-screen");
    if (title) off.querySelector("h1").textContent = title;
    if (text) off.querySelector("p").textContent = text;
    off.hidden = false;
    document.title = "Organizer (off)";
  }

  async function powerOff() {
    const ok = await waitForSave();
    if (!ok && !confirm("The last change is NOT saved. Turn off anyway?")) return;
    try { await fetch("/api/shutdown", { method: "POST" }); } catch (e) { /* already off */ }
    if (editor.open) editor.close();
    showOff();
  }

  async function main() {
    try {
      await load();
    } catch (err) {
      console.error(err);
      showOff("Organizer is not running", "Double-click Organizer on the Desktop to start it.");
      return;
    }
    initEditor();
    initTodos();
    initFilter();
    initCalendar();
    document.querySelectorAll(".view-btn").forEach((b) => b.addEventListener("click", () => setView(b.dataset.view)));
    $("power").addEventListener("click", powerOff);
    $("save-state").addEventListener("click", () => { if (dirty && !saving) flush(); });
    window.addEventListener("beforeunload", (e) => {
      if (dirty || saving) { e.preventDefault(); e.returnValue = ""; }
    });
    refreshAll();
    setSaveState("");
  }

  main();
})();
