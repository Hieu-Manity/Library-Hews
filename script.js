// script.js - SUPABASE VERSION (Shared across ALL users)

// ============================================
// SUPABASE BACKEND - TRUE CROSS-USER SHARING
// ============================================
// All users see the same data instantly
// Only admin can reset individual numbers
// ============================================

// Initialize Supabase (add your credentials)
const SUPABASE_URL = 'https://your-project.supabase.co';
const SUPABASE_ANON_KEY = 'your-anon-key';
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Admin secret key (only you know this)
const ADMIN_SECRET = 'your-secret-admin-key-here';

// Track if current user is admin
let isAdmin = false;

// ========== DATABASE OPERATIONS ==========
async function loadGlobalState() {
    const { data, error } = await supabase
        .from('trail_state')
        .select('*')
        .eq('id', 1)
        .single();
    
    if (error) {
        console.error('Error loading state:', error);
        // Initialize if not exists
        await initializeGlobalState();
        return loadGlobalState();
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

// ========== ADMIN AUTHENTICATION ==========
function promptAdminKey() {
    const key = prompt("Enter admin key to enable reset functionality:");
    if (key === ADMIN_SECRET) {
        isAdmin = true;
        alert("Admin mode enabled. You can now reset individual numbers.");
        document.getElementById('adminToggleBtn').style.display = 'inline-block';
        renderGrid(); // re-render with admin controls
    } else {
        alert("Invalid admin key.");
    }
}

// ========== CORE ACTIONS (with backend sync) ==========
async function markAsSeen(num) {
    if (!isEnabled(num)) return false;
    if (isSeen(num)) return false;
    
    seenNumbers[num] = true;
    await saveSeenNumbers(seenNumbers);
    return true;
}

async function unmarkAsSeen(num) {
    if (!isAdmin) {
        alert("Only admin can unmark numbers.");
        return false;
    }
    
    if (seenNumbers[num]) {
        delete seenNumbers[num];
        await saveSeenNumbers(seenNumbers);
        return true;
    }
    return false;
}

async function adminResetSingleNumber(num) {
    if (!isAdmin) {
        alert("Only admin can reset individual numbers.");
        return;
    }
    
    if (seenNumbers[num]) {
        delete seenNumbers[num];
        await saveSeenNumbers(seenNumbers);
        alert(`Number ${num} has been reset (unmarked).`);
    } else {
        alert(`Number ${num} was not marked.`);
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

// ========== ADMIN FUNCTIONS ==========
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

// ========== RENDER MAIN GRID (with admin unmark option) ==========
let currentFilter = 'all';

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
            tile.style.cursor = 'pointer';
            tile.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (await markAsSeen(num)) {
                    renderGrid();
                    updateStatsAndScore();
                }
            });
        } else if (seen) {
            tile.style.cursor = isAdmin ? 'pointer' : 'default';
            tile.title = isAdmin ? "Admin: Click to reset this number" : "Marked as seen";
            tile.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (isAdmin && confirm(`Reset #${num}? (unmark as seen)`)) {
                    await adminResetSingleNumber(num);
                    renderGrid();
                    updateStatsAndScore();
                }
            });
        }
        grid.appendChild(tile);
    }
}

// ========== LIVE SYNC (real-time updates across users) ==========
function setupRealtimeSync() {
    supabase
        .channel('trail_changes')
        .on('postgres_changes', 
            { event: 'UPDATE', schema: 'public', table: 'trail_state' },
            (payload) => {
                // Update local state without re-fetching everything
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

// ========== INITIALIZATION ==========
let enabledNumbers = [];
let seenNumbers = {};

async function init() {
    // Load initial state from database
    const state = await loadGlobalState();
    enabledNumbers = state.enabled_numbers;
    seenNumbers = state.seen_numbers;
    
    renderGrid();
    updateStatsAndScore();
    renderAdminToggles();
    setupRealtimeSync();
    
    // Admin button to enter admin mode
    document.getElementById('adminLoginBtn').addEventListener('click', promptAdminKey);
    document.getElementById('globalResetBtn').addEventListener('click', resetAllSeenMarks);
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