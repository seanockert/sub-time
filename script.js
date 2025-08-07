// DOM Elements
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
  timer: document.getElementById('timer')
};

// Configuration
const CONFIG = {
  DEFAULT_ROUND_TIME: 240,
  DEFAULT_GAME_TIME: 2400,
  SUB_NOTIFICATION_THRESHOLD: 5,
  ROUND_TIME_OPTIONS: [180, 240, 300, 480, 600],
  GAME_TIME_OPTIONS: [20, 30, 40, 45, 60, 90],
  DEFAULT_PLAYERS: ['Alfie', 'Amos', 'Asher', 'Bentis', 'Elias', 'Mattia', 'Ollie', 'Solly', 'William', 'Player']
};

// Player Class
class Player {
  constructor(name, id) {
    this.name = name;
    this.id = id;
    this.playTime = 0;
    this.isActive = false;
    this.lastSubTime = 0;
    this.sitOutRounds = 0;
    this.justSubbed = false;
    this.excluded = name === 'Player';
  }

  updatePlayTime() {
    if (this.isActive) this.playTime++;
  }

  resetSubState() {
    this.justSubbed = false;
  }

  canPlay() {
    return this.sitOutRounds === 0 && !this.excluded;
  }
}

// Timer Class
class Timer {
  constructor() {
    this.interval = null;
    this.startTime = null;
    this.pauseTime = 0;
    this.isPaused = false;
  }

  start(callback) {
    if (this.interval) return;
    
    this.startTime = Date.now() - this.pauseTime;
    this.isPaused = false;
    
    this.interval = setInterval(callback, 1000);
  }

  pause() {
    if (!this.interval) return;
    
    this.pauseTime = Date.now() - this.startTime;
    this.isPaused = true;
    clearInterval(this.interval);
    this.interval = null;
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.startTime = null;
    this.pauseTime = 0;
    this.isPaused = false;
  }

  getElapsedTime() {
    if (!this.startTime) return 0;
    return Math.floor((Date.now() - this.startTime) / 1000);
  }
}

// Game Manager
class GameManager {
  constructor() {
    this.players = [];
    this.timer = new Timer();
    this.roundTimer = new Timer();
    
    this.state = {
      roundTime: CONFIG.DEFAULT_ROUND_TIME,
      gameTimeLimit: CONFIG.DEFAULT_GAME_TIME,
      gameTime: 0,
      timeLeft: CONFIG.DEFAULT_ROUND_TIME,
      gameActive: false,
      substitutionCount: 2,
      notificationSent: false
    };
    
    this.nextSubstitution = { playersIn: [], playersOut: [] };
    this.loadData();
    this.initPlayers();
    this.setupEventListeners();
    this.setupIntersectionObserver();
    this.updateUI();
  }

  loadData() {
    try {
      const savedNames = localStorage.getItem('subsPlayerNames');
      this.playerNames = savedNames ? JSON.parse(savedNames) : [...CONFIG.DEFAULT_PLAYERS];
    } catch {
      this.playerNames = [...CONFIG.DEFAULT_PLAYERS];
    }
  }

  saveData() {
    try {
      localStorage.setItem('subsPlayerNames', JSON.stringify(this.playerNames));
    } catch (error) {
      console.error('Error saving data:', error);
    }
  }

  initPlayers() {
    this.players = this.playerNames.map((name, index) => new Player(name, index + 1));
  }

  setupEventListeners() {
    // Button event listeners
    els.startBtn.onclick = () => this.toggleGame();
    els.resetBtn.onclick = () => this.resetGame();
    els.resetRoundBtn.onclick = () => this.resetRound();
    els.roundTime.onclick = () => this.cycleRoundTime();
    els.gameTimeLimit.onclick = () => this.cycleGameTimeLimit();
    els.substitutionCount.onclick = () => this.cycleSubstitutionCount();
  }

  setupIntersectionObserver() {
    const scrollObserver = new IntersectionObserver(
      ([entry]) => {
        document.body.classList.toggle('scrolled', !entry.isIntersecting);
      },
      { rootMargin: '-40px 0px 0px 0px' }
    );
    
    if (els.startBtn) {
      scrollObserver.observe(els.startBtn);
    }
  }

  toggleGame() {
    if (!this.state.gameActive) {
      this.startGame();
    } else {
      this.togglePause();
    }
  }

  startGame() {
    // Auto-activate players if none active
    const activeCount = this.players.filter(p => p.isActive).length;
    if (activeCount === 0) {
      const available = this.players.filter(p => p.canPlay());
      const toActivate = Math.min(5, available.length);
      available.slice(0, toActivate).forEach(p => p.isActive = true);
    }

    this.state.gameActive = true;
    this.state.notificationSent = false;
    this.requestNotificationPermission();
    
    this.timer.start(() => this.update());
    this.roundTimer.start(() => this.updateRound());
    
    this.updateUI();
  }

  togglePause() {
    if (this.timer.isPaused) {
      this.timer.start(() => this.update());
      this.roundTimer.start(() => this.updateRound());
    } else {
      this.timer.pause();
      this.roundTimer.pause();
    }
    this.updateUI();
  }

  update() {
    if (!this.state.gameActive) return;

    this.state.gameTime = this.timer.getElapsedTime();
    
    // Update player times
    this.players.forEach(p => p.updatePlayTime());
    
    // Check game time limit
    if (this.state.gameTime >= this.state.gameTimeLimit) {
      this.timer.stop();
      this.roundTimer.stop();
      this.state.gameActive = false;
    }
    
    this.updateSubstitution();
    this.updateUI();
  }

  updateRound() {
    if (!this.state.gameActive) return;

    this.state.timeLeft = Math.max(0, this.state.roundTime - this.roundTimer.getElapsedTime());
    
    // Handle substitution
    if (this.state.timeLeft <= 0) {
      this.performSubstitution();
    }
    
    // Send notification
    if (this.state.timeLeft === CONFIG.SUB_NOTIFICATION_THRESHOLD && !this.state.notificationSent) {
      this.sendNotification();
      this.state.notificationSent = true;
    }
  }

  updateSubstitution() {
    const active = this.players.filter(p => p.isActive);
    const reserves = this.players.filter(p => !p.isActive && p.canPlay());
    
    if (active.length === 0 || reserves.length === 0) {
      this.nextSubstitution = { playersIn: [], playersOut: [] };
      return;
    }

    // Simple substitution logic: rotate players
    const subCount = Math.min(this.state.substitutionCount, Math.min(active.length, reserves.length));
    const playersOut = active.slice(0, subCount);
    const playersIn = reserves.slice(0, subCount);
    
    this.nextSubstitution = { playersIn, playersOut };
  }

  performSubstitution() {
    // Reset round timer
    this.roundTimer.stop();
    this.roundTimer.start(() => this.updateRound());
    this.state.timeLeft = this.state.roundTime;
    this.state.notificationSent = false;
    
    // Perform substitution
    this.nextSubstitution.playersOut.forEach(p => {
      p.isActive = false;
      p.justSubbed = true;
    });
    
    this.nextSubstitution.playersIn.forEach(p => {
      p.isActive = true;
      p.lastSubTime = this.state.gameTime;
    });
    
    // Decrement sit out rounds
    this.players.forEach(p => {
      if (p.sitOutRounds > 0) p.sitOutRounds--;
      p.resetSubState();
    });
    
    this.playSound();
    this.updateSubstitution();
  }

  resetRound() {
    if (!this.state.gameActive) return;
    
    const currentRoundTime = this.state.roundTime - this.state.timeLeft;
    this.players.forEach(p => {
      if (p.isActive) {
        p.playTime = Math.max(0, p.playTime - currentRoundTime);
      }
    });
    
    this.roundTimer.stop();
    this.roundTimer.start(() => this.updateRound());
    this.state.timeLeft = this.state.roundTime;
    this.state.notificationSent = false;
    
    this.updateUI();
  }

  resetGame() {
    this.timer.stop();
    this.roundTimer.stop();
    
    this.state = {
      roundTime: CONFIG.DEFAULT_ROUND_TIME,
      gameTimeLimit: CONFIG.DEFAULT_GAME_TIME,
      gameTime: 0,
      timeLeft: CONFIG.DEFAULT_ROUND_TIME,
      gameActive: false,
      substitutionCount: 2,
      notificationSent: false
    };
    
    this.initPlayers();
    this.updateUI();
  }

  cycleRoundTime() {
    const currentIndex = CONFIG.ROUND_TIME_OPTIONS.indexOf(this.state.roundTime);
    const nextIndex = (currentIndex + 1) % CONFIG.ROUND_TIME_OPTIONS.length;
    this.state.roundTime = CONFIG.ROUND_TIME_OPTIONS[nextIndex];
    this.state.timeLeft = this.state.roundTime;
    this.updateUI();
  }

  cycleGameTimeLimit() {
    const currentMinutes = this.state.gameTimeLimit / 60;
    const currentIndex = CONFIG.GAME_TIME_OPTIONS.indexOf(currentMinutes);
    const nextIndex = (currentIndex + 1) % CONFIG.GAME_TIME_OPTIONS.length;
    this.state.gameTimeLimit = CONFIG.GAME_TIME_OPTIONS[nextIndex] * 60;
    this.updateUI();
  }

  cycleSubstitutionCount() {
    this.state.substitutionCount = this.state.substitutionCount === 4 ? 1 : this.state.substitutionCount + 1;
    this.updateSubstitution();
    this.updateUI();
  }

  selectPlayer(player, type) {
    if (this.state.gameActive && !this.timer.isPaused) return;
    
    if (type === 'reserve' && !player.excluded) {
      player.isActive = true;
    } else if (type === 'active') {
      player.isActive = false;
    }
    
    this.updateSubstitution();
    this.updateUI();
  }

  cycleSitOutRounds(playerId) {
    const player = this.players.find(p => p.id === playerId);
    if (player && !player.isActive) {
      player.sitOutRounds = (player.sitOutRounds + 1) % 5;
      this.updateSubstitution();
      this.updateUI();
    }
  }

  updatePlayerName(playerId, newName) {
    const player = this.players.find(p => p.id === playerId);
    if (player) {
      const trimmedName = newName.trim();
      player.name = trimmedName || 'Player';
      
      const playerIndex = playerId - 1;
      if (playerIndex >= 0 && playerIndex < this.playerNames.length) {
        this.playerNames[playerIndex] = player.name;
        this.saveData();
      }
    }
  }

  togglePlayerExclusion(player) {
    player.excluded = !player.excluded;
    this.updateSubstitution();
    this.updateUI();
  }

  requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(console.error);
    }
  }

  sendNotification() {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    
    try {
      const onPlayers = this.nextSubstitution.playersIn.map(p => p.name).join(', ');
      const offPlayers = this.nextSubstitution.playersOut.map(p => p.name).join(', ');
      
      new Notification('Sub in 10 seconds!', {
        body: `ON: ${onPlayers}\nOFF: ${offPlayers}`,
        tag: 'substitution',
        requireInteraction: true
      });
    } catch (error) {
      console.error('Error creating notification:', error);
    }
  }

  playSound() {
    // Simple audio feedback
    const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBSuBzvLZiTYIG2m98OScTgwOUarm7blmGgU7k9n1unEiBC13yO/eizEIHWq+8+OWT');
    audio.play().catch(() => {});
  }

  formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  updateUI() {
    // Update counts
    const activeCount = this.players.filter(p => p.isActive).length;
    const reserveCount = this.players.filter(p => !p.isActive && !p.excluded).length;
    
    els.activeCount.textContent = activeCount;
    els.reserveCount.textContent = reserveCount;
    
    // Update timers
    els.timer.textContent = this.formatTime(this.state.timeLeft);
    els.gameTimer.textContent = this.formatTime(Math.max(0, this.state.gameTimeLimit - this.state.gameTime));
    
    // Update settings
    els.roundTime.textContent = this.state.roundTime / 60;
    els.gameTimeLimit.textContent = this.state.gameTimeLimit / 60;
    els.substitutionCount.textContent = this.state.substitutionCount;
    
    // Update substitution preview
    if (this.state.gameActive && this.nextSubstitution.playersIn.length > 0) {
      els.onRow.textContent = this.nextSubstitution.playersIn.map(p => p.name).join(', ');
      els.offRow.textContent = this.nextSubstitution.playersOut.map(p => p.name).join(', ');
      els.substitutionPreview.classList.add('show');
      els.substitutionPreview.classList.toggle('warning', this.state.timeLeft <= CONFIG.SUB_NOTIFICATION_THRESHOLD);
    } else {
      els.substitutionPreview.classList.remove('show', 'warning');
    }
    
    // Update start button
    if (!this.state.gameActive) {
      els.startBtn.innerHTML = '<svg fill="currentColor" viewBox="0 0 24 24"><path d="M19.3 13.5a2 2 0 0 0 0-3c-3-2.3-6.4-4.2-10-5.4l-.6-.3A2 2 0 0 0 6 6.5c-.5 3.6-.5 7.4 0 11a2 2 0 0 0 2.7 1.7l.6-.3c3.6-1.2 7-3 10-5.4Z"/></svg>Start Game';
    } else if (this.timer.isPaused) {
      els.startBtn.innerHTML = '<svg fill="currentColor" viewBox="0 0 24 24"><path d="M19.3 13.5a2 2 0 0 0 0-3c-3-2.3-6.4-4.2-10-5.4l-.6-.3A2 2 0 0 0 6 6.5c-.5 3.6-.5 7.4 0 11a2 2 0 0 0 2.7 1.7l.6-.3c3.6-1.2 7-3 10-5.4Z"/></svg>Resume';
    } else {
      els.startBtn.innerHTML = '<svg fill="currentColor" viewBox="0 0 24 24"><path d="M17.3 5.5c.4.1.7.5.7 1v11c0 .5-.3.9-.7 1-.8.3-1.8.3-2.6 0-.4-.1-.7-.5-.7-1v-11c0-.5.3-.9.7-1 .8-.3 1.8-.3 2.6 0Zm-8 0c.4.1.7.5.7 1v11c0 .5-.3.9-.7 1-.8.3-1.8.3-2.6 0-.4-.1-.7-.5-.7-1v-11c0-.5.3-.9.7-1 .8-.3 1.8-.3 2.6 0Z"/></svg>Pause';
    }
    
    // Update player lists
    this.updatePlayerLists();
  }

  updatePlayerLists() {
    els.activePlayers.innerHTML = '';
    els.reservePlayers.innerHTML = '';
    
    // Sort players: active first, then non-excluded reserves, then excluded players
    const sortedPlayers = [...this.players].sort((a, b) => {
      if (a.isActive && !b.isActive) return -1;
      if (!a.isActive && b.isActive) return 1;
      
      if (!a.isActive && !b.isActive) {
        if (a.excluded && !b.excluded) return 1;
        if (!a.excluded && b.excluded) return -1;
      }
      
      return 0;
    });
    
    sortedPlayers.forEach(player => {
      const element = this.createPlayerElement(player);
      if (player.isActive) {
        els.activePlayers.appendChild(element);
      } else {
        els.reservePlayers.appendChild(element);
      }
    });
  }

  createPlayerElement(player) {
    const div = document.createElement('li');
    div.className = `player-item${player.isActive ? ' active' : ''}${player.justSubbed ? ' subbed' : ''}${player.excluded ? ' excluded' : ''}`;
    
    if (player.isActive) {
      div.innerHTML = `
        <div class="player-name">${player.name}</div>
        <div class="player-time">${this.formatTime(player.playTime)}</div>
      `;
      div.onclick = () => this.selectPlayer(player, 'active');
    } else {
      div.innerHTML = `
        <div class="swipe-hint swipe-right"><svg fill="none" viewBox="0 0 24 24"><path fill="currentColor" d="M20 7.5 10.3 19c-1 1.2-6.5 3.8-7.2 3.2-.8-.7.9-6.6 1.8-7.7 1-1 8.4-10 9.7-11.6 1.3-1.5 2.7-1 4.3.4 2 1.6 2.4 2.6 1.1 4.2Z"/></svg></div>
        <div class="swipe-hint swipe-left"><svg fill="none" viewBox="0 0 24 24"><path fill="currentColor" fill-rule="evenodd" d="${
          player.excluded 
          ? 'M6.3 2.3c3.8-.4 7.6-.4 11.4 0 2 .2 3.7 1.9 4 4 .4 3.8.4 7.6 0 11.4-.3 2.1-2 3.8-4 4-3.8.4-7.6.4-11.4 0-2-.2-3.7-1.9-4-4C2 14 2 10.1 2.3 6.3c.3-2.1 2-3.8 4-4ZM12 6c.5 0 1 .4 1 1v4h4.2a1 1 0 1 1 0 1.8h-4.3V17a1 1 0 0 1-1.8 0v-4H6.8a1 1 0 1 1 0-1.8h4.3V6.9c0-.6.4-1 .9-1Z' 
          : 'M6.3 2.3c3.8-.4 7.6-.4 11.4 0 2 .2 3.7 1.9 4 4 .4 3.8.4 7.6 0 11.5-.3 2-2 3.7-4 4-3.8.3-7.6.3-11.4 0-2-.3-3.7-2-4-4C2 13.9 2 10 2.3 6.3c.3-2.1 2-3.8 4-4Zm1.4 5.4a1 1 0 0 1 1.3 0l3 3 3-3A1 1 0 1 1 16.3 9l-3 3 3 3a1 1 0 1 1-1.3 1.3l-3-3-3 3A1 1 0 1 1 7.7 15l3-3-3-3a1 1 0 0 1 0-1.3Z'
        }" clip-rule="evenodd"/></svg></div>
        <div class="player-content">
          <div class="player-name">
            <input type="text" value="${player.name}" class="player-name-input" 
                   data-player-id="${player.id}" 
                   onblur="game.updatePlayerName(${player.id}, this.value)">
          </div>
          <div class="inline">
            <div class="player-time">${this.formatTime(player.playTime)}</div>
            <button class="button secondary button-small button-sit-out ${player.sitOutRounds > 0 ? 'active' : ''}" 
                    onclick="event.stopPropagation(); game.cycleSitOutRounds(${player.id})">
              Sit ${Math.round(player.sitOutRounds > 0 ? (player.sitOutRounds * this.state.roundTime) / 60 : 0)}m
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

      this.setupSwipeControls(div, player, input);
      div.onclick = () => this.selectPlayer(player, 'reserve');
    }
    
    return div;
  }

  setupSwipeControls(item, player, input) {
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
          this.togglePlayerExclusion(player);
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
        this.selectPlayer(player, 'reserve');
      }
    };

    item.addEventListener('touchstart', handleTouchStart, { passive: true });
    item.addEventListener('touchmove', handleTouchMove, { passive: false });
    item.addEventListener('touchend', handleTouchEnd, { passive: true });
    item.addEventListener('click', handleClick);
  }
}

// Initialize the game
const game = new GameManager();

// Global functions for HTML onclick handlers
window.updatePlayerName = (playerId, newName) => game.updatePlayerName(playerId, newName);
window.cycleSitOutRounds = (playerId) => game.cycleSitOutRounds(playerId);