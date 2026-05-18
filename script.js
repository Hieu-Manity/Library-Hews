// ============================================
// TRAIL TRACKER - SUPABASE BACKEND
// TRUE CROSS-USER SHARING
// ============================================

// !!! REPLACE THESE WITH YOUR SUPABASE CREDENTIALS !!!
const SUPABASE_URL = 'https://irkzyzzmgeujmcwrfduw.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_RZl-L3TTQMOaujRsJr7FpA_lzLDN7AC';

// !!! SET YOUR SECRET ADMIN KEY (only you know this) !!!
const ADMIN_SECRET = 'my-secret-admin-key-123';

// Initialize Supabase
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// State
let enabledNumbers = [];
let seenNumbers = {};
let isAdmin = false;
let currentFilter = 'all';

// ========== DATABASE OPERATIONS ==========
async function loadGlobalState() {
    const { data, error } = await supabase
        .from('trail_state')
        .select('*')
        .eq('id', 1)
        .single();
    
    if (error) {
        if (error.code === 'PGRST116') {
            // No data found, initialize
            await initializeGlobalState();
            return loadGlobalState();
        }
        console.error('Error loading state:', error);
        return null;
    }
    return data;
}

async function initializeGlobalState() {
    const defaultEnabled = Array.from({ length: 100 }, (_, i) => i + 1);
    const { error } = await supabase
        .from('trail_state')
        .insert({
            id: 1,
            enabled_numbers: defaultEnabled,
            seen_numbers: {}
        });
    
    if (error) console.error('Init error:', error);
}

async function saveEnabledNumbers(enabledArr) {
    const { error } = await supabase
        .from('trail_state')
        .update({ enabled_numbers: enabledArr })
        .eq('id', 1);
    
    if (!error) {
        enabledNumbers = enabledArr;
        renderAdminToggles();
        renderGrid();
        updateStatsAndScore();
    }
}

async function saveSeenNumbers(seenObj) {
    const { error } = await supabase
        .from('trail_state')
        .update({ seen_numbers: seenObj })
        .eq('id', 1);
    
    if (!error) {
        seenNumbers = seenObj;
        renderGrid();
        updateStatsAndScore();
    }
}

// ========== REAL-TIME SYNC ==========
function setupRealtimeSync() {
    supabase
        .channel('trail_changes')
        .on('postgres_changes', 
            { event: 'UPDATE', schema: 'public', table: 'trail_state' },
            (payload) => {
                if (payload.new.enabled_numbers) {
                    enabledNumbers = payload.new.enabled_numbers;
                }
                if (payload.new.seen_numbers) {
                    seenNumbers = payload.new.seen_numbers;
                }
                renderGrid();
                updateStatsAndScore();
                renderAdminToggles();
            }
        )
        .subscribe();
}

// ========== HELPER FUNCTIONS ==========
function isEnabled(num) {
    return enabledNumbers.includes(num);
}

function isSeen(num) {
    return seenNumbers[num] === true;
}

// ========== CORE ACTIONS ==========
async function markAsSeen(num) {
    if (!isEnabled(num)) return false;
    if (isSeen(num)) return false;
    
    seenNumbers[num] = true;
    await saveSeenNumbers(seenNumbers);
    return true;
}

async function adminResetSingleNumber(num) {
    if (!isAdmin) {
        alert("Only admin can reset individual numbers.");
        return false;
    }
    
    if (seenNumbers[num]) {
        delete seenNumbers[num];
        await saveSeenNumbers(seenNumbers);
        alert(`✓ Number ${num} has been reset (unmarked).`);
        return true;
    } else {
        alert(`Number ${num} was not marked.`);
        return false;
    }
}

async function resetAllSeenMarks() {
    if (!isAdmin) {
        alert("Only admin can reset all marks.");
        return;
    }
    
    if (confirm("⚠️ ADMIN: Reset ALL seen marks for EVERYONE?")) {
        seenNumbers = {};
        await saveSeenNumbers(seenNumbers);
    }
}

// ========== ADMIN FUNCTIONS (Enable/Disable Numbers) ==========
async function adminEnableNumber(num) {
    if (!enabledNumbers.includes(num)) {
        enabledNumbers.push(num);
        enabledNumbers.sort((a, b) => a - b);
        await saveEnabledNumbers(enabledNumbers);
    }
}

async function adminDisableNumber(num) {
    enabledNumbers = enabledNumbers.filter(n => n !== num);
    await saveEnabledNumbers(enabledNumbers);
    if (seenNumbers[num]) {
        delete seenNumbers[num];
        await saveSeenNumbers(seenNumbers);
    }
}

async function adminEnableAll() {
    enabledNumbers = Array.from({ length: 100 }, (_, i) => i + 1);
    await saveEnabledNumbers(enabledNumbers);
}

async function adminDisableAll() {
    enabledNumbers = [];
    await saveEnabledNumbers(enabledNumbers);
    seenNumbers = {};
    await saveSeenNumbers(seenNumbers);
}

// ========== STATS & SCORE ==========
function computeStats() {
    let totalEnabled = enabledNumbers.length;
    let seenCount = 0;
    for (let num of enabledNumbers) {
        if (seenNumbers[num]) seenCount++;
    }
    let remaining = totalEnabled - seenCount;
    let percent = totalEnabled === 0 ? 0 : Math.round((seenCount / totalEnabled) * 100);
    return { totalEnabled, seenCount, remaining, percent };
}

function updateStatsAndScore() {
    const stats = computeStats();
    document.getElementById('seenCount').innerText = stats.seenCount;
    document.getElementById('totalEnabled').innerText = stats.totalEnabled;
    document.getElementById('activeStat').innerText = stats.totalEnabled;
    document.getElementById('remainingStat').innerText = stats.remaining;
    document.getElementById('percentStat').innerText = `${stats.percent}%`;
}

// ========== RENDER MAIN GRID (VISIBLE NUMBERS 1-100) ==========
function renderGrid() {
    const grid = document.getElementById('tilesGrid');
    if (!grid) return;
    grid.innerHTML = '';
    
    const allNumbers = Array.from({ length: 100 }, (_, i) => i + 1);
    let filteredNumbers = allNumbers;
    
    if (currentFilter === 'active') {
        filteredNumbers = allNumbers.filter(n => isEnabled(n) && !isSeen(n));
    } else if (currentFilter === 'seen') {
        filteredNumbers = allNumbers.filter(n => isSeen(n));
    } else {
        filteredNumbers = allNumbers;
    }
    
    for (let num of filteredNumbers) {
        const enabled = isEnabled(num);
        const seen = isSeen(num);
        const tile = document.createElement('div');
        tile.className = 'tile';
        if (seen) tile.classList.add('seen');
        if (!enabled) tile.classList.add('disabled');
        tile.innerText = num;
        
        if (enabled && !seen) {
            // Not seen yet -> click to mark
            tile.style.cursor = 'pointer';
            tile.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (await markAsSeen(num)) {
                    renderGrid();
                    updateStatsAndScore();
                    // Show brief feedback
                    const btn = document.getElementById('globalResetBtn');
                    const original = btn.innerText;
                    btn.innerText = `✓ marked ${num}`;
                    setTimeout(() => { btn.innerText = original; }, 1200);
                }
            });
        } else if (seen) {
            // Already seen -> only admin can unmark
            tile.style.cursor = isAdmin ? 'pointer' : 'default';
            tile.title = isAdmin ? "Admin: Click to reset this number" : "Already marked";
            if (isAdmin) {
                tile.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    if (confirm(`Reset #${num}? (unmark as seen)`)) {
                        await adminResetSingleNumber(num);
                        renderGrid();
                        updateStatsAndScore();
                    }
                });
            }
        } else {
            tile.style.cursor = 'default';
        }
        grid.appendChild(tile);
    }
}

// ========== RENDER ADMIN TOGGLE LIST ==========
function renderAdminToggles() {
    const container = document.getElementById('toggleList');
    if (!container) return;
    container.innerHTML = '';
    for (let i = 1; i <= 100; i++) {
        const isActive = enabledNumbers.includes(i);
        const div = document.createElement('div');
        div.className = `toggle-item ${isActive ? 'enabled' : 'disabled'}`;
        div.innerText = i;
        div.addEventListener('click', async () => {
            if (isActive) {
                await adminDisableNumber(i);
            } else {
                await adminEnableNumber(i);
            }
            renderAdminToggles();
            renderGrid();
            updateStatsAndScore();
        });
        container.appendChild(div);
    }
}

// ========== ADMIN AUTHENTICATION ==========
function promptAdminKey() {
    const key = prompt("Enter admin key:");
    if (key === ADMIN_SECRET) {
        isAdmin = true;
        alert("✅ Admin mode enabled. You can now reset individual numbers by clicking on marked tiles.");
        document.getElementById('adminToggleBtn').style.display = 'inline-block';
        document.getElementById('adminLoginBtn').style.display = 'none';
        renderGrid(); // re-render with admin click handlers
    } else if (key !== null) {
        alert("❌ Invalid admin key.");
    }
}

function toggleAdminMode() {
    const panel = document.getElementById('adminPanel');
    const btn = document.getElementById('adminToggleBtn');
    if (panel.classList.contains('show')) {
        panel.classList.remove('show');
        btn.classList.remove('active');
        btn.innerText = '🔧 admin mode';
    } else {
        panel.classList.add('show');
        btn.classList.add('active');
        btn.innerText = '🔒 exit admin';
        renderAdminToggles();
    }
}

// ========== FILTER BUTTONS ==========
function setFilter(filter) {
    currentFilter = filter;
    document.querySelectorAll('.filter-btn').forEach(btn => {
        if (btn.getAttribute('data-filter') === filter) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
    renderGrid();
}

// ========== INITIALIZATION ==========
async function init() {
    // Show loading state
    document.getElementById('tilesGrid').innerHTML = '<div style="text-align:center; padding:2rem;">Loading...</div>';
    
    const state = await loadGlobalState();
    if (state) {
        enabledNumbers = state.enabled_numbers;
        seenNumbers = state.seen_numbers;
    }
    
    renderGrid();
    updateStatsAndScore();
    renderAdminToggles();
    setupRealtimeSync();
    
    // Event listeners
    document.getElementById('globalResetBtn').addEventListener('click', resetAllSeenMarks);
    document.getElementById('adminLoginBtn').addEventListener('click', promptAdminKey);
    document.getElementById('adminToggleBtn').addEventListener('click', toggleAdminMode);
    document.getElementById('enableAllBtn').addEventListener('click', async () => { 
        await adminEnableAll(); 
    });
    document.getElementById('disableAllBtn').addEventListener('click', async () => { 
        await adminDisableAll(); 
    });
    
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const filter = e.target.getAttribute('data-filter');
            if (filter) setFilter(filter);
        });
    });
}

init();