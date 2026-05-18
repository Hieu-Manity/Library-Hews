// ============================================
// TRAIL TRACKER - SUPABASE BACKEND
// TRUE CROSS-USER SHARING
// ============================================

(function() {
    'use strict';
    
    // Check if already initialized
    if (window.__trailTrackerInitialized) {
        console.warn('Trail Tracker already initialized, skipping duplicate');
        return;
    }
    window.__trailTrackerInitialized = true;
    
    // !!! REPLACE THESE WITH YOUR SUPABASE CREDENTIALS !!!
    const SUPABASE_URL = 'https://irkzyzzmgeujmcwrfduw.supabase.co';
    const SUPABASE_ANON_KEY = 'sb_publishable_RZl-L3TTQMOaujRsJr7FpA_lzLDN7AC';
    
    // !!! SET YOUR SECRET ADMIN KEY (only you know this) !!!
    const ADMIN_SECRET = 'my-secret-admin-key-123';
    
    // Initialize Supabase client
    const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    
    console.log("Script starting...");
    console.log("Supabase URL:", SUPABASE_URL);
    
    // State
    let enabledNumbers = [];
    let seenNumbers = {};
    let isAdmin = false;
    let currentFilter = 'all';
    let isInitializing = false;
    
    // ========== DATABASE OPERATIONS ==========
    async function loadGlobalState() {
        try {
            console.log("Loading global state...");
            const { data, error } = await supabaseClient
                .from('trail_state')
                .select('*')
                .eq('id', 1)
                .single();
            
            if (error) {
                console.error("Error loading state:", error);
                
                if (error.code === 'PGRST116' && !isInitializing) {
                    console.log("No state found, attempting to initialize...");
                    const success = await initializeGlobalState();
                    if (success) {
                        return loadGlobalState();
                    }
                }
                return null;
            }
            console.log("State loaded successfully:", data);
            return data;
        } catch (err) {
            console.error("Unexpected error in loadGlobalState:", err);
            return null;
        }
    }
    
    async function initializeGlobalState() {
        if (isInitializing) {
            console.log("Already initializing, skipping...");
            return false;
        }
        
        isInitializing = true;
        
        try {
            const defaultEnabled = Array.from({ length: 100 }, (_, i) => i + 1);
            console.log("Attempting to insert initial state...");
            
            const { data, error } = await supabaseClient
                .from('trail_state')
                .insert({
                    id: 1,
                    enabled_numbers: defaultEnabled,
                    seen_numbers: {}
                })
                .select();
            
            if (error) {
                console.error('Init error details:', error);
                
                if (error.code === '42501') {
                    console.error('RLS POLICY ERROR: Please enable anonymous inserts in Supabase!');
                    showRLSErrorMessage();
                }
                return false;
            }
            
            console.log("Initial state created successfully:", data);
            return true;
        } catch (err) {
            console.error("Exception during initialization:", err);
            return false;
        } finally {
            isInitializing = false;
        }
    }
    
    function showRLSErrorMessage() {
        const grid = document.getElementById('tilesGrid');
        if (grid) {
            grid.innerHTML = `
                <div style="text-align:center; padding:2rem; background:#fff3f3; border:2px solid #ff0000; border-radius:8px;">
                    <h3 style="color:#ff0000;">⚠️ Supabase Configuration Required</h3>
                    <p>Please enable Row Level Security (RLS) for anonymous access:</p>
                    <ol style="text-align:left; display:inline-block; margin:1rem auto;">
                        <li>Go to your <strong>Supabase Dashboard</strong></li>
                        <li>Select <strong>Authentication → Policies</strong></li>
                        <li>Find the <strong>trail_state</strong> table</li>
                        <li>Add policy for <strong>INSERT</strong> and <strong>SELECT</strong> operations</li>
                        <li>Set policy to: <code>true</code> (for testing)</li>
                    </ol>
                    <p><button onclick="location.reload()" style="padding:8px 16px; background:#007bff; color:white; border:none; border-radius:4px; cursor:pointer;">Retry</button></p>
                </div>
            `;
        }
    }
    
    async function saveEnabledNumbers(enabledArr) {
        const { error } = await supabaseClient
            .from('trail_state')
            .update({ enabled_numbers: enabledArr })
            .eq('id', 1);
        
        if (error) {
            console.error('Error saving enabled numbers:', error);
            if (error.code === '42501') {
                showRLSErrorMessage();
            }
            return false;
        }
        
        enabledNumbers = enabledArr;
        renderAdminToggles();
        renderGrid();
        updateStatsAndScore();
        return true;
    }
    
    async function saveSeenNumbers(seenObj) {
        const { error } = await supabaseClient
            .from('trail_state')
            .update({ seen_numbers: seenObj })
            .eq('id', 1);
        
        if (error) {
            console.error('Error saving seen numbers:', error);
            if (error.code === '42501') {
                showRLSErrorMessage();
            }
            return false;
        }
        
        seenNumbers = seenObj;
        renderGrid();
        updateStatsAndScore();
        return true;
    }
    
    // ========== REAL-TIME SYNC ==========
    function setupRealtimeSync() {
        supabaseClient
            .channel('trail_changes')
            .on('postgres_changes', 
                { event: 'UPDATE', schema: 'public', table: 'trail_state' },
                (payload) => {
                    console.log("Realtime update received:", payload);
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
            .subscribe((status) => {
                console.log("Realtime subscription status:", status);
            });
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
            document.getElementById('adminLoginBtn').style.display = 'none';
            document.getElementById('adminPanel').classList.add('show');
            renderAdminToggles();
            renderGrid();
        } else if (key !== null) {
            alert("❌ Invalid admin key.");
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
    
    // ========== EXPORT/IMPORT FUNCTIONS ==========
    function exportData() {
        const data = {
            enabledNumbers: enabledNumbers,
            seenNumbers: seenNumbers,
            exportDate: new Date().toISOString()
        };
        const dataStr = JSON.stringify(data, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `trail-tracker-backup-${new Date().toISOString().slice(0,19)}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }
    
    function importData(file) {
        const reader = new FileReader();
        reader.onload = async function(e) {
            try {
                const data = JSON.parse(e.target.result);
                if (data.enabledNumbers && Array.isArray(data.enabledNumbers)) {
                    enabledNumbers = data.enabledNumbers;
                    await saveEnabledNumbers(enabledNumbers);
                }
                if (data.seenNumbers && typeof data.seenNumbers === 'object') {
                    seenNumbers = data.seenNumbers;
                    await saveSeenNumbers(seenNumbers);
                }
                alert("✅ Data imported successfully!");
                renderGrid();
                updateStatsAndScore();
                renderAdminToggles();
            } catch (err) {
                alert("❌ Invalid backup file");
            }
        };
        reader.readAsText(file);
    }
    
    // ========== INITIALIZATION ==========
    async function init() {
        try {
            console.log("Init function started...");
            
            // Show loading state
            const grid = document.getElementById('tilesGrid');
            if (grid) {
                grid.innerHTML = '<div style="text-align:center; padding:2rem;">Loading Supabase data...</div>';
            } else {
                console.error("tilesGrid element NOT FOUND!");
                return;
            }
            
            const state = await loadGlobalState();
            console.log("State loaded:", state);
            
            if (state) {
                enabledNumbers = state.enabled_numbers;
                seenNumbers = state.seen_numbers;
                console.log("Enabled numbers:", enabledNumbers.length);
                console.log("Seen numbers:", Object.keys(seenNumbers).length);
            }
            
            renderGrid();
            console.log("Grid rendered");
            
            updateStatsAndScore();
            renderAdminToggles();
            setupRealtimeSync();
            
            // Event listeners
            const resetBtn = document.getElementById('resetAllSeenBtn');
            if (resetBtn) resetBtn.addEventListener('click', resetAllSeenMarks);
            
            const fullResetBtn = document.getElementById('fullResetBtn');
            if (fullResetBtn) {
                fullResetBtn.addEventListener('click', async () => {
                    if (confirm("💀 FULL RESET: This will reset ALL data (enabled numbers AND seen marks). Are you absolutely sure?")) {
                        await adminEnableAll();
                        seenNumbers = {};
                        await saveSeenNumbers(seenNumbers);
                        alert("Full reset complete!");
                    }
                });
            }
            
            const adminLoginBtn = document.getElementById('adminLoginBtn');
            if (adminLoginBtn) adminLoginBtn.addEventListener('click', promptAdminKey);
            
            const enableAllBtn = document.getElementById('enableAllBtn');
            if (enableAllBtn) {
                enableAllBtn.addEventListener('click', async () => { 
                    await adminEnableAll(); 
                });
            }
            
            const disableAllBtn = document.getElementById('disableAllBtn');
            if (disableAllBtn) {
                disableAllBtn.addEventListener('click', async () => { 
                    await adminDisableAll(); 
                });
            }
            
            const exportBtn = document.getElementById('exportDataBtn');
            if (exportBtn) exportBtn.addEventListener('click', exportData);
            
            const importBtn = document.getElementById('importDataBtn');
            const importFileInput = document.getElementById('importFileInput');
            if (importBtn && importFileInput) {
                importBtn.addEventListener('click', () => importFileInput.click());
                importFileInput.addEventListener('change', (e) => {
                    if (e.target.files.length > 0) {
                        importData(e.target.files[0]);
                        importFileInput.value = '';
                    }
                });
            }
            
            document.querySelectorAll('.filter-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const filter = e.target.getAttribute('data-filter');
                    if (filter) setFilter(filter);
                });
            });
            
        } catch (error) {
            console.error("Init failed:", error);
            const grid = document.getElementById('tilesGrid');
            if (grid) {
                grid.innerHTML = `<div style="text-align:center; padding:2rem; color:red;">Error: ${error.message}<br><br>Check console for details.</div>`;
            }
        }
    }
    
    // Start the app when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
    
})(); // <-- THIS CLOSES THE IIFE - MAKE SURE IT'S AT THE VERY END
