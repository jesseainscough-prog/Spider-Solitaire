
(() => {
  const root = document.querySelector('.game-shell');
  const columnsEl = document.getElementById('columns');
  const boardEl = document.getElementById('board');
  const stockEl = document.getElementById('stock');
  const stockLabel = document.getElementById('stockLabel');
  const completedEl = document.getElementById('completed');
  const statusEl = document.getElementById('status');
  const moveEl = document.getElementById('moves');
  const scoreEl = document.getElementById('score');
  const timerEl = document.getElementById('timer');
  const undoBtn = document.getElementById('undo');
  const hintBtn = document.getElementById('hint');
  const dealBtn = document.getElementById('deal');
  const newBtn = document.getElementById('newGameTop');
  const toastEl = document.getElementById('toast');

  const ranks = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
  const value = rank => ranks.indexOf(rank) + 1;

  let state;
  let history = [];
  let selected = null;
  let hintMove = null;
  let started = false;
  let startAt = 0;
  let timerId = null;
  let pointer = null;

  const toast = msg => {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastEl._timer);
    toastEl._timer = setTimeout(() => toastEl.classList.remove('show'), 1200);
  };

  function makeDeck() {
    const deck = [];
    let id = 0;
    for (let set = 0; set < 8; set++) {
      for (const rank of ranks) deck.push({ id: id++, rank, faceUp: false });
    }
    return deck;
  }

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
  }

  function cloneState() {
    return JSON.parse(JSON.stringify(state));
  }

  function remember() {
    history.push(cloneState());
    if (history.length > 100) history.shift();
  }

  function fmt(sec) {
    return String(Math.floor(sec / 60)).padStart(2, '0') + ':' +
           String(sec % 60).padStart(2, '0');
  }

  function startClock() {
    if (started) return;
    started = true;
    startAt = Date.now() - state.elapsed * 1000;
    timerId = setInterval(() => {
      state.elapsed = Math.floor((Date.now() - startAt) / 1000);
      renderStats();
    }, 1000);
  }

  function stopClock() {
    if (timerId) clearInterval(timerId);
    timerId = null;
  }

  function renderStats() {
    moveEl.textContent = state.moves;
    scoreEl.textContent = Math.max(0, 500 - state.moves + state.completed * 100);
    timerEl.textContent = fmt(state.elapsed);
  }

  function newGame() {
    stopClock();
    started = false;
    history = [];
    selected = null;
    hintMove = null;

    const deck = makeDeck();
    shuffle(deck);
    const cols = Array.from({ length: 10 }, () => []);

    for (let row = 0; row < 6; row++) {
      for (let c = 0; c < 10; c++) {
        if (row < 5 || c < 4) cols[c].push(deck.pop());
      }
    }
    cols.forEach(c => c[c.length - 1].faceUp = true);

    state = { cols, stock: deck, moves: 0, completed: 0, elapsed: 0 };
    statusEl.textContent = 'Tap a movable card or stack. Smart Tap will make the best obvious move.';
    render();
  }

  function movable(col, index) {
    const cards = state.cols[col];
    if (index < 0 || !cards[index]?.faceUp) return false;

    for (let i = index; i < cards.length - 1; i++) {
      if (!cards[i + 1].faceUp) return false;
      if (value(cards[i].rank) !== value(cards[i + 1].rank) + 1) return false;
    }
    return true;
  }

  function legal(from, index, to) {
    if (from === to || !movable(from, index)) return false;
    const moving = state.cols[from][index];
    const dest = state.cols[to];
    return dest.length === 0 ||
      value(dest[dest.length - 1].rank) === value(moving.rank) + 1;
  }

  function flipTop(col) {
    const cards = state.cols[col];
    if (cards.length && !cards[cards.length - 1].faceUp) cards[cards.length - 1].faceUp = true;
  }

  function completeRun(col) {
    const cards = state.cols[col];
    if (cards.length < 13) return false;
    const start = cards.length - 13;

    for (let i = 0; i < 13; i++) {
      const card = cards[start + i];
      if (!card.faceUp || value(card.rank) !== 13 - i) return false;
    }

    cards.splice(start, 13);
    state.completed++;
    flipTop(col);
    return true;
  }

  function postAction() {
    for (let c = 0; c < 10; c++) {
      while (completeRun(c)) {}
    }

    if (state.completed === 8) {
      stopClock();
      statusEl.textContent = `You won in ${state.moves} moves and ${fmt(state.elapsed)}!`;
      toast('You win!');
    }
    render();
  }

  function performMove(from, index, to, message = 'Moved.') {
    if (!legal(from, index, to)) return false;

    remember();
    startClock();
    state.cols[to].push(...state.cols[from].splice(index));
    flipTop(from);
    state.moves++;
    selected = null;
    hintMove = null;
    statusEl.textContent = message;
    postAction();
    return true;
  }

  function legalDestinations(from, index) {
    const out = [];
    for (let to = 0; to < 10; to++) {
      if (legal(from, index, to)) out.push(to);
    }
    return out;
  }

  function moveScore(from, index, to) {
    const source = state.cols[from];
    const dest = state.cols[to];
    const revealsFaceDown = index > 0 && !source[index - 1].faceUp;
    const usesEmpty = dest.length === 0;

    let score = 0;
    if (revealsFaceDown) score += 1000;
    if (!usesEmpty) score += 400;
    if (usesEmpty) score -= 150;

    // Prefer moves that continue a longer descending run at destination.
    if (dest.length) score += 25;

    // Prefer moving longer sequences.
    score += (source.length - index) * 4;

    return score;
  }

  function bestDestination(from, index) {
    const dests = legalDestinations(from, index);
    if (!dests.length) return null;

    return dests
      .map(to => ({ to, score: moveScore(from, index, to) }))
      .sort((a, b) => b.score - a.score)[0];
  }

  function smartTap(col, index) {
    if (!movable(col, index)) {
      statusEl.textContent = 'That card or stack cannot be moved.';
      return;
    }

    const best = bestDestination(col, index);

    if (best) {
      performMove(col, index, best.to, 'Smart move completed.');
      return;
    }

    selected = { col, index };
    hintMove = null;
    statusEl.textContent = 'No automatic move found. Select the destination manually or drag.';
    render();
  }

  function tapDestination(col) {
    if (!selected) return;
    if (performMove(selected.col, selected.index, col, 'Manual move completed.')) return;
    statusEl.textContent = 'That destination is not allowed.';
  }

  function deal() {
    if (state.stock.length < 10) {
      statusEl.textContent = 'No more cards to deal.';
      return;
    }

    if (state.cols.some(c => c.length === 0)) {
      statusEl.textContent = 'Fill all empty columns before dealing.';
      toast('Fill empty columns first');
      return;
    }

    remember();
    startClock();

    for (let c = 0; c < 10; c++) {
      const card = state.stock.pop();
      card.faceUp = true;
      state.cols[c].push(card);
    }

    state.moves++;
    selected = null;
    hintMove = null;
    statusEl.textContent = 'Dealt one new card to every column.';
    postAction();
  }

  function findHint() {
    const candidates = [];

    for (let from = 0; from < 10; from++) {
      for (let index = 0; index < state.cols[from].length; index++) {
        if (!movable(from, index)) continue;

        for (let to = 0; to < 10; to++) {
          if (legal(from, index, to)) {
            candidates.push({
              from,
              index,
              to,
              score: moveScore(from, index, to)
            });
          }
        }
      }
    }

    if (!candidates.length) return null;
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0];
  }

  function showHint() {
    hintMove = findHint();
    selected = null;

    if (!hintMove) {
      if (state.stock.length >= 10 && !state.cols.some(c => c.length === 0)) {
        statusEl.textContent = 'No useful tableau move found. Try dealing a new row.';
        toast('Try Deal');
      } else {
        statusEl.textContent = 'No legal move found right now.';
      }
      render();
      return;
    }

    statusEl.textContent = 'Hint: highlighted stack → highlighted destination.';
    render();
  }

  function offsets(cards) {
    const result = [];
    let y = 0;
    for (const card of cards) {
      result.push(y);
      // Compact backs to preserve vertical room.
      y += card.faceUp ? 27 : 11;
    }
    return result;
  }

  function render() {
    columnsEl.innerHTML = '';

    state.cols.forEach((cards, colIndex) => {
      const col = document.createElement('div');
      col.className = 'column';
      col.dataset.col = colIndex;

      if (hintMove && hintMove.to === colIndex) col.classList.add('hint-target');

      const ys = offsets(cards);

      if (!cards.length) {
        const empty = document.createElement('div');
        empty.className = 'empty-slot';
        col.appendChild(empty);
      }

      cards.forEach((card, index) => {
        const el = document.createElement('div');
        el.className = 'card ' + (card.faceUp ? 'face' : 'back');
        el.style.top = ys[index] + 'px';
        el.style.zIndex = index + 1;
        el.dataset.col = colIndex;
        el.dataset.index = index;

        if (selected && selected.col === colIndex && index >= selected.index) {
          el.classList.add('selected');
        }
        if (hintMove && hintMove.from === colIndex && index >= hintMove.index) {
          el.classList.add('hint-source');
        }

        if (card.faceUp) {
          el.innerHTML = `<div class="rank">${card.rank}</div><div class="suit">♠</div>`;
          el.addEventListener('pointerdown', e => pointerDown(e, colIndex, index, el));
          el.addEventListener('pointerup', e => pointerUp(e, colIndex, index));
        }

        col.appendChild(el);
      });

      col.addEventListener('pointerup', e => {
        if (e.target === col || e.target.classList.contains('empty-slot')) {
          tapDestination(colIndex);
        }
      });

      columnsEl.appendChild(col);
    });

    const deals = Math.floor(state.stock.length / 10);
    stockEl.innerHTML = '';
    for (let i = 0; i < deals; i++) {
      const s = document.createElement('div');
      s.className = 'stock-card';
      s.style.left = (i * 2) + 'px';
      s.style.top = (-i) + 'px';
      stockEl.appendChild(s);
    }
    stockLabel.textContent = `${deals} Deal${deals === 1 ? '' : 's'} Left`;
    dealBtn.disabled = deals === 0;

    completedEl.innerHTML = '';
    for (let i = 0; i < state.completed; i++) {
      const c = document.createElement('div');
      c.className = 'complete-card';
      c.textContent = '♠';
      completedEl.appendChild(c);
    }

    undoBtn.disabled = history.length === 0;
    renderStats();
  }

  function pointerDown(e, col, index, el) {
    if (!movable(col, index)) return;

    pointer = {
      id: e.pointerId,
      col,
      index,
      startX: e.clientX,
      startY: e.clientY,
      dragging: false,
      el,
      holder: null,
      dx: 0,
      dy: 0
    };

    el.setPointerCapture?.(e.pointerId);
    document.addEventListener('pointermove', pointerMove, { passive: false });
  }

  function pointerMove(e) {
    if (!pointer || e.pointerId !== pointer.id) return;

    const dx = e.clientX - pointer.startX;
    const dy = e.clientY - pointer.startY;

    if (!pointer.dragging && Math.hypot(dx, dy) < 12) return;

    if (!pointer.dragging) {
      pointer.dragging = true;

      const boardRect = boardEl.getBoundingClientRect();
      const cardRect = pointer.el.getBoundingClientRect();
      const moving = state.cols[pointer.col].slice(pointer.index);

      const holder = document.createElement('div');
      holder.className = 'drag-stack';
      holder.style.width = cardRect.width + 'px';
      holder.style.height = (cardRect.height + (moving.length - 1) * 27) + 'px';
      holder.style.left = (cardRect.left - boardRect.left) + 'px';
      holder.style.top = (cardRect.top - boardRect.top) + 'px';

      pointer.dx = e.clientX - cardRect.left;
      pointer.dy = e.clientY - cardRect.top;

      moving.forEach((card, i) => {
        const d = document.createElement('div');
        d.className = 'drag-card';
        d.style.top = (i * 27) + 'px';
        d.innerHTML = `<div class="rank">${card.rank}</div><div class="suit">♠</div>`;
        holder.appendChild(d);
      });

      boardEl.appendChild(holder);
      pointer.holder = holder;
    }

    e.preventDefault();

    const boardRect = boardEl.getBoundingClientRect();
    pointer.holder.style.left = (e.clientX - boardRect.left - pointer.dx) + 'px';
    pointer.holder.style.top = (e.clientY - boardRect.top - pointer.dy) + 'px';

    document.querySelectorAll('.column').forEach(x => x.classList.remove('drop-target'));
    const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('.column');
    if (target && legal(pointer.col, pointer.index, Number(target.dataset.col))) {
      target.classList.add('drop-target');
    }
  }

  function pointerUp(e, col, index) {
    document.removeEventListener('pointermove', pointerMove);
    if (!pointer) return;

    document.querySelectorAll('.column').forEach(x => x.classList.remove('drop-target'));

    const p = pointer;
    pointer = null;

    if (p.dragging) {
      const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('.column');
      p.holder?.remove();

      if (target && performMove(p.col, p.index, Number(target.dataset.col), 'Dragged move completed.')) return;

      statusEl.textContent = 'Drag canceled.';
      return;
    }

    // Single tap = Smart Tap.
    smartTap(col, index);
  }

  function undo() {
    if (!history.length) return;

    state = history.pop();
    selected = null;
    hintMove = null;

    stopClock();
    started = false;

    if (state.elapsed || state.moves) {
      started = true;
      startAt = Date.now() - state.elapsed * 1000;
      timerId = setInterval(() => {
        state.elapsed = Math.floor((Date.now() - startAt) / 1000);
        renderStats();
      }, 1000);
    }

    statusEl.textContent = 'Last action undone.';
    render();
  }

  undoBtn.addEventListener('click', undo);
  hintBtn.addEventListener('click', showHint);
  dealBtn.addEventListener('click', deal);
  newBtn.addEventListener('click', () => {
    if (confirm('Start a new game?')) newGame();
  });

  newGame();
})();
