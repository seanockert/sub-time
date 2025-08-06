const DEFAULT_ROUND_TIME = 240;
const DEFAULT_GAME_TIME = 2400;
const SUB_NOTIFICATION_THRESHOLD = 5;
const ROUND_TIME_OPTIONS = [180, 240, 300, 480, 600];
const GAME_TIME_OPTIONS = [20, 30, 40, 45, 60, 90];

let roundTime = DEFAULT_ROUND_TIME;
let gameTimeLimit = DEFAULT_GAME_TIME;
let gameActive = false;
let paused = false;
let timeLeft = roundTime;
let timerInterval;
let gameTime = 0;
let substitutionCount = 2;
let notificationSent = false;
let substitutionDelayTimer = null;
let shouldDelaySubstitutionUpdate = false;

const els = {
  activeCount: document.getElementById('activeCount'),
  activePlayers: document.getElementById('activePlayers'),
  gameTimeLimit: document.getElementById('gameTimeLimit'),
  gameTimer: document.getElementById('gameTimer'),
  offRow: document.getElementById('offRow'),
  onRow: document.getElementById('onRow'),
  reserveCount: document.getElementById('reserveCount'),
  reservePlayers: document.getElementById('reservePlayers'),
  resetBtn: document.getElementById('resetBtn'),
  resetRoundBtn: document.getElementById('resetRoundBtn'),
  roundTime: document.getElementById('roundTime'),
  startBtn: document.getElementById('startBtn'),
  substitutionCount: document.getElementById('substitutionCount'),
  substitutionPreview: document.getElementById('substitutionPreview'),
  timer: document.getElementById('timer'),
};

const defaultPlayerNames = [
  'Alfie',
  'Amos',
  'Asher',
  'Bentis',
  'Elias',
  'Mattia',
  'Ollie',
  'Solly',
  'William',
  'Player',
];

let playerNames = [];

let allPlayers = [];
let selectedForSubstitution = { playersIn: [], playersOut: [] };
let nextSubstitution = { playersIn: [], playersOut: [] };

function loadPlayerNames() {
  const savedNames = localStorage.getItem('subsPlayerNames');
  if (savedNames) {
    try {
      playerNames = JSON.parse(savedNames);
    } catch (error) {
      playerNames = [...defaultPlayerNames];
    }
  } else {
    playerNames = [...defaultPlayerNames];
  }
}

function savePlayerNames() {
  try {
    localStorage.setItem('subsPlayerNames', JSON.stringify(playerNames));
  } catch (error) {
    console.error('Error saving player names to localStorage:', error);
  }
}

function saveExcludedPlayers() {
  try {
    const excludedPlayerIds = allPlayers.filter((p) => p.excluded).map((p) => p.id);
    localStorage.setItem('subsExcludedPlayers', JSON.stringify(excludedPlayerIds));
  } catch (error) {
    console.error('Error saving excluded players to localStorage:', error);
  }
}

function loadExcludedPlayers() {
  const savedExcluded = localStorage.getItem('subsExcludedPlayers');
  if (savedExcluded) {
    try {
      const excludedPlayerIds = JSON.parse(savedExcluded);
      allPlayers.forEach((player) => {
        player.excluded = excludedPlayerIds.includes(player.id);
      });
    } catch (error) {
      console.error('Error loading excluded players from localStorage:', error);
    }
  }
}

function initPlayers() {
  allPlayers = playerNames.map((name, index) => ({
    name,
    id: index + 1,
    playTime: 0,
    isActive: false,
    lastSubTime: 0,
    sitOutRounds: 0,
    justSubbed: false,
    excluded: name === 'Player',
  }));
}

function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission().catch(console.error);
  }
}

function sendNotification(playersIn, playersOut) {
  if (!('Notification' in window) || Notification.permission !== 'granted') {
    return;
  }

  try {
    const onPlayers = playersIn.map((p) => p.name).join(', ');
    const offPlayers = playersOut.map((p) => p.name).join(', ');

    const notification = new Notification('Sub in 10 seconds!', {
      body: `ON: ${onPlayers}\nOFF: ${offPlayers}`,
      tag: 'substitution',
      requireInteraction: true,
      silent: false,
      icon: '/icon.png',
    });

    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  } catch (error) {
    console.error('Error creating notification:', error);
  }
}

function calculateSubstitution() {
  const activePlayers = [];
  const availableReserves = [];

  for (const p of allPlayers) {
    if (p.isActive) {
      activePlayers.push(p);
    } else if (p.sitOutRounds === 0 && !p.excluded) {
      availableReserves.push(p);
    }
  }
  const totalGameMinutes = gameTime / 60;
  const targetPlayTime = (totalGameMinutes * 5) / allPlayers.length;

  const mustSubOut = activePlayers.filter((p) => gameTime - p.lastSubTime >= roundTime * 3);

  const shouldSubOut = activePlayers
    .filter((p) => !mustSubOut.includes(p))
    .sort((a, b) => {
      const playTimeDiff = b.playTime - a.playTime;
      const threshold = Math.max(15, roundTime / 4);
      if (Math.abs(playTimeDiff) > threshold) {
        return playTimeDiff;
      }
      return gameTime - b.lastSubTime - (gameTime - a.lastSubTime);
    });

  const availableByPriority = availableReserves.sort((a, b) => {
    const aUnderTarget = Math.max(0, targetPlayTime * 60 - a.playTime);
    const bUnderTarget = Math.max(0, targetPlayTime * 60 - b.playTime);
    const fairnessThreshold = Math.max(30, roundTime / 2);
    if (Math.abs(aUnderTarget - bUnderTarget) > fairnessThreshold) {
      return bUnderTarget - aUnderTarget;
    }

    const playTimeDiff = a.playTime - b.playTime;
    const playTimeThreshold = Math.max(10, roundTime / 4);
    if (Math.abs(playTimeDiff) > playTimeThreshold) {
      return playTimeDiff;
    }

    return gameTime - b.lastSubTime - (gameTime - a.lastSubTime);
  });

  const maxSubs = Math.min(substitutionCount, availableByPriority.length);
  const minRequiredSubs = mustSubOut.length;
  let actualSubCount = Math.max(minRequiredSubs, Math.min(maxSubs, activePlayers.length));

  if (actualSubCount === 0 && activePlayers.length > 0 && availableByPriority.length > 0) {
    actualSubCount = 1;
  }

  const playersOut = [
    ...mustSubOut.slice(0, actualSubCount),
    ...shouldSubOut.slice(0, Math.max(0, actualSubCount - mustSubOut.length)),
  ];

  const playersIn = availableByPriority.slice(0, actualSubCount);

  return { playersIn, playersOut };
}

function updateSubstitutionCalculation() {
  if (!gameActive || shouldDelaySubstitutionUpdate) {
    return;
  }

  const newSubstitution = calculateSubstitution();
  const hasChanged =
    newSubstitution.playersIn.length !== nextSubstitution.playersIn.length ||
    newSubstitution.playersOut.length !== nextSubstitution.playersOut.length ||
    newSubstitution.playersIn.some((p, i) => p.id !== nextSubstitution.playersIn[i]?.id) ||
    newSubstitution.playersOut.some((p, i) => p.id !== nextSubstitution.playersOut[i]?.id);

  if (hasChanged) {
    nextSubstitution = newSubstitution;
    updateSubstitutionDOM();
  }

  if (timeLeft <= SUB_NOTIFICATION_THRESHOLD) {
    els.substitutionPreview.classList.add('warning');
  } else {
    els.substitutionPreview.classList.remove('warning');
  }

  if (timeLeft === SUB_NOTIFICATION_THRESHOLD && !notificationSent) {
    sendNotification(nextSubstitution.playersIn, nextSubstitution.playersOut);
    notificationSent = true;
  }
}

function updateSubstitutionDOM() {
  if (!gameActive) {
    els.substitutionPreview.classList.remove('show');
    return;
  }

  els.onRow.innerHTML = nextSubstitution.playersIn.map((p) => p.name).join(', ');
  els.offRow.innerHTML = nextSubstitution.playersOut.map((p) => p.name).join(', ');

  const wasVisible = els.substitutionPreview.classList.contains('show');

  if (wasVisible) {
    els.substitutionPreview.classList.remove('show');
    setTimeout(() => els.substitutionPreview.classList.add('show'), 10);
  } else {
    els.substitutionPreview.classList.add('show');
  }
}

function updateSubstitutionDisplay() {
  updateSubstitutionCalculation();
}

function updateSubstitutionCount() {
  substitutionCount = substitutionCount === 4 ? 1 : substitutionCount + 1;
  els.substitutionCount.textContent = substitutionCount;
  updateSubstitutionDisplay();
}

function updateRoundTime() {
  const currentIndex = ROUND_TIME_OPTIONS.indexOf(roundTime);
  const nextIndex = (currentIndex + 1) % ROUND_TIME_OPTIONS.length;
  roundTime = ROUND_TIME_OPTIONS[nextIndex];
  timeLeft = roundTime;
  els.roundTime.textContent = roundTime / 60;
  updateDisplay();
  updateTimer();
  updateSubstitutionDisplay();
}

function updateGameTimeLimit() {
  const currentMinutes = gameTimeLimit / 60;
  const currentIndex = GAME_TIME_OPTIONS.indexOf(currentMinutes);
  const nextIndex = (currentIndex + 1) % GAME_TIME_OPTIONS.length;
  const nextMinutes = GAME_TIME_OPTIONS[nextIndex];
  gameTimeLimit = nextMinutes * 60;
  els.gameTimeLimit.textContent = nextMinutes;
  updateGameTimer();
}

function cycleSitOutRounds(playerId) {
  const player = allPlayers.find((p) => p.id === playerId);
  if (player && !player.isActive) {
    player.sitOutRounds = (player.sitOutRounds + 1) % 5;
    updateDisplay();
    updateSubstitutionDisplay();
  }
}

function decrementSitOutRounds() {
  allPlayers.forEach((player) => {
    if (player.sitOutRounds > 0) player.sitOutRounds--;
  });
}

function addTapAndLongPress(element, tapFn, longPressFn, delay = 500) {
  let timer = null;
  let isLongPress = false;

  function start(e) {
    e.preventDefault();
    isLongPress = false;
    timer = setTimeout(() => {
      isLongPress = true;
      longPressFn();
    }, delay);
  }

  function end(e) {
    if (timer) {
      clearTimeout(timer);
      if (!isLongPress) tapFn();
    }
  }

  function cancel() {
    if (timer) clearTimeout(timer);
  }

  element.addEventListener('pointerdown', start);
  element.addEventListener('pointerup', end);
  element.addEventListener('pointercancel', cancel);
  element.addEventListener('pointerleave', cancel);
  element.addEventListener('contextmenu', (e) => e.preventDefault());
}

function createPlayerElement(player, isActive) {
  const div = document.createElement('li');
  div.className = `player-item${isActive ? ' active' : ''}${player.justSubbed ? ' subbed' : ''}${
    player.excluded ? ' excluded' : ''
  }`;

  if (isActive) {
    div.innerHTML = `
      <div class="player-name">${player.name}</div>
      <div class="player-time">${formatTime(player.playTime)}</div>
    `;
    div.onclick = () => selectPlayer(player, 'active');
  } else {
    div.innerHTML = `
      <div class="swipe-hint swipe-right"><svg fill="none" viewBox="0 0 24 24"><path fill="currentColor" d="M20 7.5 10.3 19c-1 1.2-6.5 3.8-7.2 3.2-.8-.7.9-6.6 1.8-7.7 1-1 8.4-10 9.7-11.6 1.3-1.5 2.7-1 4.3.4 2 1.6 2.4 2.6 1.1 4.2Z"/></svg>
</div>
      <div class="swipe-hint swipe-left"><svg fill="none" viewBox="0 0 24 24"><path fill="currentColor" fill-rule="evenodd" d="${
        player.excluded 
          ? 'M6.3 2.3c3.8-.4 7.6-.4 11.4 0 2 .2 3.7 1.9 4 4 .4 3.8.4 7.6 0 11.4-.3 2.1-2 3.8-4 4-3.8.4-7.6.4-11.4 0-2-.2-3.7-1.9-4-4C2 14 2 10.1 2.3 6.3c.3-2.1 2-3.8 4-4ZM12 6c.5 0 1 .4 1 1v4h4.2a1 1 0 1 1 0 1.8h-4.3V17a1 1 0 0 1-1.8 0v-4H6.8a1 1 0 1 1 0-1.8h4.3V6.9c0-.6.4-1 .9-1Z' 
          : 'M6.3 2.3c3.8-.4 7.6-.4 11.4 0 2 .2 3.7 1.9 4 4 .4 3.8.4 7.6 0 11.5-.3 2-2 3.7-4 4-3.8.3-7.6.3-11.4 0-2-.3-3.7-2-4-4C2 13.9 2 10 2.3 6.3c.3-2.1 2-3.8 4-4Zm1.4 5.4a1 1 0 0 1 1.3 0l3 3 3-3A1 1 0 1 1 16.3 9l-3 3 3 3a1 1 0 1 1-1.3 1.3l-3-3-3 3A1 1 0 1 1 7.7 15l3-3-3-3a1 1 0 0 1 0-1.3Z'
      }" clip-rule="evenodd"/></svg></div>
      <div class="player-content">
        <div class="player-name">
          <input type="text" 
            value="${player.name}" 
            class="player-name-input"
            placeholder="Name..."
            data-player-id="${player.id}"
            onblur="updatePlayerName(${player.id}, this.value)">
        </div>
        <div class="inline">
          <div class="player-time">${formatTime(player.playTime)}</div>
          <button class="button secondary button-small button-sit-out ${
            player.sitOutRounds > 0 ? 'active' : ''
          }" onclick="event.stopPropagation(); cycleSitOutRounds(${player.id})">
            Sit ${Math.round(player.sitOutRounds > 0 ? (player.sitOutRounds * roundTime) / 60 : 0)}m
          </button>
        </div>
      </div>
    `;

    const playerContent = div.querySelector('.player-content');
    const input = div.querySelector('.player-name-input');

    input.addEventListener('focus', () => {
      document.body.style.overflowX = 'hidden';
      document.body.style.touchAction = 'pan-y';
    });
    
    input.addEventListener('blur', () => {
      document.body.style.overflowX = '';
      document.body.style.touchAction = '';
    });

    setupSwipeControls(div, player, input);
    div.onclick = () => selectPlayer(player, 'reserve');
  }

  return div;
}

function updateDisplay() {
  const activePlayers = [];
  const reservePlayers = [];
  const excludedPlayers = [];

  for (const player of allPlayers) {
    if (player.isActive) {
      activePlayers.push(player);
    } else if (player.excluded) {
      excludedPlayers.push(player);
    } else {
      reservePlayers.push(player);
    }
  }

  els.activeCount.textContent = activePlayers.length;
  els.reserveCount.textContent = reservePlayers.length;

  els.activePlayers.innerHTML = '';
  for (const player of activePlayers) {
    els.activePlayers.appendChild(createPlayerElement(player, true));
  }

  els.reservePlayers.innerHTML = '';
  for (const player of reservePlayers) {
    els.reservePlayers.appendChild(createPlayerElement(player, false));
  }

  for (const player of excludedPlayers) {
    els.reservePlayers.appendChild(createPlayerElement(player, false));
  }
}

function selectPlayer(player, type) {
  if (gameActive && !paused) {
    return;
  }

  if (!gameActive) {
    let activeCount = 0;
    for (const p of allPlayers) {
      if (p.isActive) activeCount++;
    }

    if (type === 'reserve' && !player.excluded) {
      player.isActive = true;
    } else if (type === 'active') {
      player.isActive = false;
    }
    updateDisplay();
    updateGameStatus();
  }
}

function updateGameStatus() {
  if (!gameActive) {
    els.startBtn.innerHTML =
      '<svg fill="currentColor" viewBox="0 0 24 24"><path d="M19.3 13.5a2 2 0 0 0 0-3c-3-2.3-6.4-4.2-10-5.4l-.6-.3A2 2 0 0 0 6 6.5c-.5 3.6-.5 7.4 0 11a2 2 0 0 0 2.7 1.7l.6-.3c3.6-1.2 7-3 10-5.4Z" clip-rule="evenodd"/></svg>Start Game';
  } else if (paused) {
    els.startBtn.innerHTML =
      '<svg fill="currentColor" viewBox="0 0 24 24"><path d="M19.3 13.5a2 2 0 0 0 0-3c-3-2.3-6.4-4.2-10-5.4l-.6-.3A2 2 0 0 0 6 6.5c-.5 3.6-.5 7.4 0 11a2 2 0 0 0 2.7 1.7l.6-.3c3.6-1.2 7-3 10-5.4Z" clip-rule="evenodd"/></svg>Resume';
  } else {
    els.startBtn.innerHTML =
      '<svg fill="currentColor" viewBox="0 0 24 24"><path d="M17.3 5.5c.4.1.7.5.7 1v11c0 .5-.3.9-.7 1-.8.3-1.8.3-2.6 0-.4-.1-.7-.5-.7-1v-11c0-.5.3-.9.7-1 .8-.3 1.8-.3 2.6 0Zm-8 0c.4.1.7.5.7 1v11c0 .5-.3.9-.7 1-.8.3-1.8.3-2.6 0-.4-.1-.7-.5-.7-1v-11c0-.5.3-.9.7-1 .8-.3 1.8-.3 2.6 0Z" clip-rule="evenodd"/></svg>Pause';
  }
}

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function updatePlayTime() {
  allPlayers.forEach((player) => {
    if (player.isActive) player.playTime++;
  });
}

function updateTimer() {
  els.timer.textContent = formatTime(timeLeft);
  els.timer.classList.toggle('warning', timeLeft <= 30);
}

function updateGameTimer() {
  const timeElapsed = gameTimeLimit - gameTime;
  els.gameTimer.textContent = formatTime(Math.max(0, timeElapsed));
}

function updatePlayerTimes() {
  const activePlayers = allPlayers.filter((p) => p.isActive);
  const reservePlayers = allPlayers.filter((p) => !p.isActive);

  const activeEls = els.activePlayers.children;
  for (let i = 0; i < activeEls.length; i++) {
    const timeElement = activeEls[i].querySelector('.player-time');
    if (timeElement && activePlayers[i]) {
      timeElement.textContent = formatTime(activePlayers[i].playTime);
    }
  }

  const reserveEls = els.reservePlayers.children;
  for (let i = 0; i < reserveEls.length; i++) {
    const timeElement = reserveEls[i].querySelector('.player-time');
    if (timeElement && reservePlayers[i]) {
      timeElement.textContent = formatTime(reservePlayers[i].playTime);
    }
  }
}

function startTimer() {
  timerInterval = setInterval(() => {
    if (!paused) {
      timeLeft--;
      gameTime++;

      updatePlayTime();
      updateTimer();
      updateGameTimer();
      updatePlayerTimes();

      if (timeLeft % 60 === 0) { updateDisplay(); }

      updateSubstitutionCalculation();

      if (gameTime >= gameTimeLimit) {
        paused = true;
        updateGameStatus();
        return;
      }

      if (timeLeft <= 0) { handleSubstitution(); }
    }
  }, 1000);
}

function toggleGame() {
  if (!gameActive) {
    startGame();
  } else {
    togglePause();
  }
}

function startGame() {
  let activeCount = 0;
  for (const p of allPlayers) {
    if (p.isActive) activeCount++;
  }

  if (activeCount < 1) {
    const availablePlayers = allPlayers.filter((p) => p.sitOutRounds === 0 && !p.excluded);
    const playersToActivate = Math.min(5, availablePlayers.length);

    const shuffled = [...availablePlayers].sort(() => Math.random() - 0.5);
    for (let i = 0; i < playersToActivate; i++) {
      shuffled[i].isActive = true;
    }

    updateDisplay();
  }

  requestNotificationPermission();

  gameActive = true;
  paused = false;
  notificationSent = false;

  startTimer();
  updateGameStatus();
  updateSubstitutionDisplay();
}

function togglePause() {
  paused = !paused;
  updateGameStatus();
}

function resetRound() {
  if (!gameActive) {
    return;
  }

  const currentRoundTime = roundTime - timeLeft;
  allPlayers.forEach((player) => {
    if (player.isActive) {
      player.playTime = Math.max(0, player.playTime - currentRoundTime);
    }
  });

  timeLeft = roundTime;
  notificationSent = false;

  updateTimer();
  updateGameTimer();
  updateDisplay();
  updateSubstitutionDisplay();
}

function resetGame() {
  gameActive = false;
  paused = false;
  timeLeft = roundTime;
  gameTime = 0;
  notificationSent = false;
  els.substitutionPreview.classList.remove('show');

  clearInterval(timerInterval);

  initPlayers();
  loadExcludedPlayers();
  updateTimer();
  updateGameTimer();
  updateDisplay();
  updateGameStatus();
  updateSubstitutionDisplay();
}

function handleSubstitution() {
  clearInterval(timerInterval);
  playSound();

  allPlayers.forEach((player) => (player.justSubbed = false));

  nextSubstitution.playersOut.forEach((player) => {
    player.isActive = false;
    player.justSubbed = true;
  });

  nextSubstitution.playersIn.forEach((player) => {
    player.isActive = true;
    player.lastSubTime = gameTime;
  });

  decrementSitOutRounds();

  timeLeft = roundTime;
  notificationSent = false;
  updateTimer();
  updateDisplay();

  shouldDelaySubstitutionUpdate = true;
  if (substitutionDelayTimer) clearTimeout(substitutionDelayTimer);

  substitutionDelayTimer = setTimeout(() => {
    shouldDelaySubstitutionUpdate = false;
    updateSubstitutionDisplay();
  }, SUB_NOTIFICATION_THRESHOLD * 1000);

  startTimer();
}

function updatePlayerName(playerId, newName) {
  const player = allPlayers.find((p) => p.id === playerId);
  if (player) {
    const trimmedName = newName.trim();
    player.name = trimmedName || 'Player';

    const playerIndex = playerId - 1;
    if (playerIndex >= 0 && playerIndex < playerNames.length) {
      playerNames[playerIndex] = player.name;
      savePlayerNames();
    }
  }
}

function excludePlayer(player) {
  player.excluded = true;
  saveExcludedPlayers();
  updateDisplay();
  updateSubstitutionDisplay();
}

function includePlayer(player) {
  player.excluded = false;
  saveExcludedPlayers();
  updateDisplay();
  updateSubstitutionDisplay();
}

function setupSwipeControls(item, player, input) {
  const playerContent = item.querySelector('.player-content');

  let startX = 0;
  let startY = 0;
  let currentX = 0;
  let isDragging = false;
  let isVerticalScroll = false;

  const handleTouchStart = (e) => {
    if (item.classList.contains('editing')) {
      return;
    }

    const touch = e.touches[0];
    startX = touch.clientX;
    startY = touch.clientY;
    currentX = 0;
    isDragging = false;
    isVerticalScroll = false;

    item.querySelectorAll('.swipe-hint svg').forEach((svg) => (svg.style.transform = ''));
    item.classList.add('swiping');
  };

  const handleTouchMove = (e) => {
    if (item.classList.contains('editing')) {
      return;
    }

    const touch = e.touches[0];
    const deltaX = touch.clientX - startX;
    const deltaY = touch.clientY - startY;

    if (!isDragging && !isVerticalScroll) {
      if (Math.abs(deltaY) > Math.abs(deltaX)) {
        isVerticalScroll = true;
        item.classList.remove('swiping');
        return;
      } else if (Math.abs(deltaX) > 10) {
        isDragging = true;
        e.preventDefault();
      }
    }

    if (!isDragging || isVerticalScroll) {
      return;
    }

    e.preventDefault();

    currentX = deltaX;
    const maxMove = 100;
    const clampedX = Math.max(-maxMove, Math.min(maxMove, currentX));
    playerContent.style.transform = `translateX(${clampedX}px)`;

    const scale = 1 + (Math.abs(clampedX) / maxMove) * 0.5;
    const targetHint = clampedX > 0 ? '.swipe-right' : '.swipe-left';

    item.querySelectorAll('.swipe-hint svg').forEach((svg) => {
      svg.style.transform = svg.closest(targetHint) ? `scale(${scale})` : 'scale(1)';
    });
  };

  const handleTouchEnd = (e) => {
    if (!isDragging || isVerticalScroll) {
      item.classList.remove('swiping');
      return;
    }

    item.classList.remove('swiping');
    playerContent.style.transform = '';
    item.querySelectorAll('.swipe-hint svg').forEach((svg) => (svg.style.transform = ''));

    const threshold = 50;

    if (Math.abs(currentX) > threshold) {
      if (currentX > 0) {
        input.focus();
        input.select();
      } else {
        if (player.excluded) {
          includePlayer(player);
        } else {
          excludePlayer(player);
        }
      }
    }

    isDragging = false;
    isVerticalScroll = false;
  };

  const handleClick = (e) => {
    if (isDragging || item.classList.contains('editing')) {
      e.preventDefault();
      return;
    }

    if (!player.excluded) {
      selectPlayer(player, 'reserve');
    }
  };

  item.addEventListener('touchstart', handleTouchStart, { passive: true });
  item.addEventListener('touchmove', handleTouchMove, { passive: false });
  item.addEventListener('touchend', handleTouchEnd, { passive: true });
  item.addEventListener('click', handleClick);
}

loadPlayerNames();
initPlayers();
loadExcludedPlayers();
updateDisplay();
updateGameStatus();
updateTimer();
updateGameTimer();
updateSubstitutionDisplay();

const scrollObserver = new IntersectionObserver(
  ([entry]) => {
    document.body.classList.toggle('scrolled', !entry.isIntersecting);
  },
  { rootMargin: '-40px 0px 0px 0px' }
);

scrollObserver.observe(els.startBtn);

let audioContext = null;
let audioBuffer = null;
let audioSource = null;
let audioLoaded = false;
let audioLoading = false;

async function initAudio() {
  try {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    await loadAudioFile();
  } catch (error) {
    console.error('Failed to initialize audio:', error);
  }
}

async function loadAudioFile() {
  if (audioLoading || audioLoaded) return;
  
  audioLoading = true;
  
  try {
    const response = await fetch('./subs.mp3');
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const arrayBuffer = await response.arrayBuffer();
    audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    audioLoaded = true;
  } catch (error) {
    console.error('Failed to load audio file:', error);
    audioLoaded = false;
  } finally {
    audioLoading = false;
  }
}

const playSound = () => {
  if (audioContext && audioContext.state === 'suspended') {
    audioContext.resume().catch(console.error);
  }
  
  if (audioLoaded && audioBuffer && audioContext) {
      if (audioSource) {
        audioSource.stop();
      }
      
      audioSource = audioContext.createBufferSource();
      audioSource.buffer = audioBuffer;
      audioSource.connect(audioContext.destination);
      audioSource.start(0);
      return;
  }
};

const initAudioOnUserInteraction = () => {
  if (!audioContext) {
    initAudio();
  }
  document.removeEventListener('pointerdown', initAudioOnUserInteraction);
};

document.addEventListener('pointerdown', initAudioOnUserInteraction, { once: true });
