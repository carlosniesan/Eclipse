// Estados de las celdas
const STATES = {
    EMPTY: 0,
    SUN: 1,
    MOON: 2
};

const CONSTRAINT_TYPES = {
    EQUAL: '=',
    DIFFERENT: 'x'
};

const GRID_SIZE = 6;
const REQUIRED_COUNT = 3; // 3 soles y 3 lunas por fila/columna

// Grid del juego
let grid = Array(GRID_SIZE).fill().map(() => Array(GRID_SIZE).fill(STATES.EMPTY));
let lockedCells = new Set(); // Celdas bloqueadas que no se pueden modificar
let constraints = []; // Restricciones entre casillas { row1, col1, row2, col2, type: '=' o 'x' }
let history = []; // Historial de acciones para deshacer

// Estado del juego
let isMuted = false;
let currentTheme = 'light';
let validationTimeout = null; // Para el debounce de validación

// Sistema de sonidos usando Web Audio API
const audioContext = new (window.AudioContext || window.webkitAudioContext)();

// Función para crear sonidos con frecuencias
function playSound(frequency, duration, type = 'sine') {
    if (isMuted) return;
    
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    oscillator.frequency.value = frequency;
    oscillator.type = type;
    
    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration);
    
    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + duration);
}

// Sonidos del juego
const sounds = {
    click: () => playSound(400, 0.1, 'sine'),
    sun: () => {
        playSound(600, 0.15, 'sine');
        setTimeout(() => playSound(800, 0.1, 'sine'), 50);
    },
    moon: () => {
        playSound(300, 0.15, 'sine');
        setTimeout(() => playSound(250, 0.1, 'sine'), 50);
    },
    success: () => {
        [523, 659, 784, 1047].forEach((freq, i) => {
            setTimeout(() => playSound(freq, 0.2, 'sine'), i * 100);
        });
    },
    error: () => {
        playSound(200, 0.3, 'sawtooth');
    }
};

// Inicializar el juego
function init() {
    generateRandomPuzzle();
    createGrid();
    updateGrid();
}

// Crear el grid HTML
function createGrid() {
    const gridElement = document.getElementById('grid');
    gridElement.innerHTML = '';
    
    for (let row = 0; row < GRID_SIZE; row++) {
        for (let col = 0; col < GRID_SIZE; col++) {
            // Crear celda
            const cell = document.createElement('div');
            cell.className = 'cell';
            cell.dataset.row = row;
            cell.dataset.col = col;
            cell.style.gridRow = row + 1;
            cell.style.gridColumn = col + 1;
            
            const cellKey = `${row}-${col}`;
            if (!lockedCells.has(cellKey)) {
                cell.addEventListener('click', handleCellClick);
            } else {
                cell.classList.add('locked');
            }
            
            gridElement.appendChild(cell);
        }
    }
    
    // Agregar restricciones después de las celdas
    constraints.forEach(constraint => {
        const constraintEl = document.createElement('div');
        constraintEl.className = 'constraint';
        constraintEl.textContent = constraint.type;
        constraintEl.dataset.row1 = constraint.row1;
        constraintEl.dataset.col1 = constraint.col1;
        constraintEl.dataset.row2 = constraint.row2;
        constraintEl.dataset.col2 = constraint.col2;
        
        const cellSize = 60;
        const gap = 5;
        const padding = 10;
        
        // Determinar si es horizontal o vertical y calcular posición
        if (constraint.row1 === constraint.row2) {
            // Horizontal - entre dos columnas en la misma fila
            constraintEl.classList.add('horizontal');
            const col = Math.min(constraint.col1, constraint.col2);
            const row = constraint.row1;
            
            // Calcular posición exacta
            const left = padding + (col * cellSize) + (col * gap) + cellSize + (gap / 2);
            const top = padding + (row * cellSize) + (row * gap) + (cellSize / 2);
            
            constraintEl.style.left = `${left}px`;
            constraintEl.style.top = `${top}px`;
        } else {
            // Vertical - entre dos filas en la misma columna
            constraintEl.classList.add('vertical');
            const row = Math.min(constraint.row1, constraint.row2);
            const col = constraint.col1;
            
            // Calcular posición exacta
            const left = padding + (col * cellSize) + (col * gap) + (cellSize / 2);
            const top = padding + (row * cellSize) + (row * gap) + cellSize + (gap / 2);
            
            constraintEl.style.left = `${left}px`;
            constraintEl.style.top = `${top}px`;
        }
        
        gridElement.appendChild(constraintEl);
    });
}

// Manejar click en celda
function handleCellClick(e) {
    const row = parseInt(e.target.dataset.row);
    const col = parseInt(e.target.dataset.col);
    
    const cellKey = `${row}-${col}`;
    if (lockedCells.has(cellKey)) return; // No permitir cambiar celdas bloqueadas
    
    const oldState = grid[row][col];
    
    // Guardar estado anterior en el historial
    history.push({
        row: row,
        col: col,
        previousState: oldState
    });
    
    // Limitar historial a 50 acciones
    if (history.length > 50) {
        history.shift();
    }
    
    // Ciclar entre estados: vacío -> sol -> luna -> vacío
    grid[row][col] = (grid[row][col] + 1) % 3;
    
    // Actualizar estado del botón deshacer
    updateUndoButton();
    
    // Reproducir sonido según el nuevo estado
    const newState = grid[row][col];
    if (newState === STATES.EMPTY) {
        sounds.click();
    } else if (newState === STATES.SUN) {
        sounds.sun();
    } else if (newState === STATES.MOON) {
        sounds.moon();
    }
    
    updateGrid();
    clearMessage();
    
    // Cancelar el timeout anterior si existe
    if (validationTimeout) {
        clearTimeout(validationTimeout);
    }
    
    // Validar después de 0.5 segundos
    validationTimeout = setTimeout(() => {
        validateGrid();
        checkAutoWin();
    }, 500);
}

// Actualizar visualización del grid
function updateGrid() {
    const cells = document.querySelectorAll('.cell');
    
    cells.forEach(cell => {
        const row = parseInt(cell.dataset.row);
        const col = parseInt(cell.dataset.col);
        const state = grid[row][col];
        const cellKey = `${row}-${col}`;
        
        // Limpiar clases pero preservar locked
        const isLocked = lockedCells.has(cellKey);
        cell.className = 'cell';
        if (isLocked) {
            cell.classList.add('locked');
        }
        
        // Aplicar clase según estado
        switch(state) {
            case STATES.SUN:
                cell.classList.add('sun');
                cell.textContent = '☀️';
                break;
            case STATES.MOON:
                cell.classList.add('moon');
                cell.textContent = '🌙';
                break;
            default:
                cell.textContent = '';
        }
    });
}

// Verificar si hay más de 2 consecutivos
function checkConsecutive(arr) {
    for (let i = 0; i < arr.length - 2; i++) {
        if (arr[i] !== STATES.EMPTY && 
            arr[i] === arr[i + 1] && 
            arr[i] === arr[i + 2]) {
            return false;
        }
    }
    return true;
}

// Contar elementos en un array
function countElements(arr) {
    const counts = { sun: 0, moon: 0 };
    arr.forEach(state => {
        if (state === STATES.SUN) counts.sun++;
        if (state === STATES.MOON) counts.moon++;
    });
    return counts;
}

// Verificar solución completa
function checkSolution() {
    const errors = [];
    
    // Verificar filas
    for (let row = 0; row < GRID_SIZE; row++) {
        const rowData = grid[row];
        const counts = countElements(rowData);
        
        if (counts.sun !== REQUIRED_COUNT || counts.moon !== REQUIRED_COUNT) {
            errors.push(`Fila ${row + 1}: Necesita ${REQUIRED_COUNT} soles y ${REQUIRED_COUNT} lunas`);
        }
        
        if (!checkConsecutive(rowData)) {
            errors.push(`Fila ${row + 1}: Más de 2 elementos consecutivos iguales`);
        }
    }
    
    // Verificar columnas
    for (let col = 0; col < GRID_SIZE; col++) {
        const colData = grid.map(row => row[col]);
        const counts = countElements(colData);
        
        if (counts.sun !== REQUIRED_COUNT || counts.moon !== REQUIRED_COUNT) {
            errors.push(`Columna ${col + 1}: Necesita ${REQUIRED_COUNT} soles y ${REQUIRED_COUNT} lunas`);
        }
        
        if (!checkConsecutive(colData)) {
            errors.push(`Columna ${col + 1}: Más de 2 elementos consecutivos iguales`);
        }
    }
    
    // Verificar restricciones
    constraints.forEach((constraint, idx) => {
        const val1 = grid[constraint.row1][constraint.col1];
        const val2 = grid[constraint.row2][constraint.col2];
        
        if (val1 !== STATES.EMPTY && val2 !== STATES.EMPTY) {
            if (constraint.type === CONSTRAINT_TYPES.EQUAL && val1 !== val2) {
                errors.push(`Restricción ${idx + 1}: Las casillas deben ser iguales`);
            } else if (constraint.type === CONSTRAINT_TYPES.DIFFERENT && val1 === val2) {
                errors.push(`Restricción ${idx + 1}: Las casillas deben ser diferentes`);
            }
        }
    });
    
    return errors;
}

// Validar grid y marcar errores visualmente
function validateGrid() {
    // Primero limpiar todos los errores
    const cells = document.querySelectorAll('.cell');
    cells.forEach(cell => cell.classList.remove('error'));
    
    const constraintEls = document.querySelectorAll('.constraint');
    constraintEls.forEach(el => el.classList.remove('error'));
    
    const errorCells = new Set();
    
    // Verificar filas
    for (let row = 0; row < GRID_SIZE; row++) {
        const rowData = grid[row];
        const counts = countElements(rowData);
        const hasConsecutiveError = !checkConsecutive(rowData);
        
        // Marcar error si hay más de 3 del mismo tipo
        if (counts.sun > REQUIRED_COUNT || counts.moon > REQUIRED_COUNT || hasConsecutiveError) {
            // Marcar todas las celdas de esta fila
            for (let col = 0; col < GRID_SIZE; col++) {
                if (grid[row][col] !== STATES.EMPTY) {
                    errorCells.add(`${row}-${col}`);
                }
            }
        }
    }
    
    // Verificar columnas
    for (let col = 0; col < GRID_SIZE; col++) {
        const colData = grid.map(row => row[col]);
        const counts = countElements(colData);
        const hasConsecutiveError = !checkConsecutive(colData);
        
        // Marcar error si hay más de 3 del mismo tipo
        if (counts.sun > REQUIRED_COUNT || counts.moon > REQUIRED_COUNT || hasConsecutiveError) {
            // Marcar todas las celdas de esta columna
            for (let row = 0; row < GRID_SIZE; row++) {
                if (grid[row][col] !== STATES.EMPTY) {
                    errorCells.add(`${row}-${col}`);
                }
            }
        }
    }
    
    // Verificar restricciones
    constraints.forEach(constraint => {
        const val1 = grid[constraint.row1][constraint.col1];
        const val2 = grid[constraint.row2][constraint.col2];
        
        if (val1 !== STATES.EMPTY && val2 !== STATES.EMPTY) {
            let hasError = false;
            
            if (constraint.type === CONSTRAINT_TYPES.EQUAL && val1 !== val2) {
                hasError = true;
            } else if (constraint.type === CONSTRAINT_TYPES.DIFFERENT && val1 === val2) {
                hasError = true;
            }
            
            if (hasError) {
                errorCells.add(`${constraint.row1}-${constraint.col1}`);
                errorCells.add(`${constraint.row2}-${constraint.col2}`);
                
                // No marcar la restricción, solo las celdas
            }
        }
    });
    
    // Aplicar clase de error a las celdas marcadas
    errorCells.forEach(cellId => {
        const [row, col] = cellId.split('-');
        const cell = document.querySelector(`[data-row="${row}"][data-col="${col}"]`);
        if (cell) {
            cell.classList.add('error');
        }
    });
}

// Verificar si el tablero está completo y correcto
function checkAutoWin() {
    // Contar celdas vacías
    let emptyCount = 0;
    for (let row = 0; row < GRID_SIZE; row++) {
        for (let col = 0; col < GRID_SIZE; col++) {
            if (grid[row][col] === STATES.EMPTY) {
                emptyCount++;
            }
        }
    }
    
    // Si no hay celdas vacías, verificar si ha ganado
    if (emptyCount === 0) {
        const errors = checkSolution();
        if (errors.length === 0) {
            // ¡Victoria!
            setTimeout(() => {
                showVictoryModal();
                sounds.success();
                celebrateWin();
            }, 300);
        }
    }
}

// Mostrar mensaje
function showMessage(text, isSuccess) {
    const messageEl = document.getElementById('message');
    messageEl.textContent = text;
    messageEl.className = 'message ' + (isSuccess ? 'success' : 'error');
}

// Limpiar mensaje
function clearMessage() {
    const messageEl = document.getElementById('message');
    messageEl.textContent = '';
    messageEl.className = 'message';
}

// Actualizar estado del botón deshacer
function updateUndoButton() {
    const undoBtn = document.getElementById('undoBtn');
    if (undoBtn) {
        undoBtn.disabled = history.length === 0;
    }
}

// Función deshacer
function undo() {
    if (history.length === 0) return;
    
    const lastAction = history.pop();
    grid[lastAction.row][lastAction.col] = lastAction.previousState;
    
    updateGrid();
    updateUndoButton();
    clearMessage();
    sounds.click();
    
    // Cancelar validación pendiente y revalidar
    if (validationTimeout) {
        clearTimeout(validationTimeout);
    }
    validationTimeout = setTimeout(() => {
        validateGrid();
        checkAutoWin();
    }, 500);
}

// Animación de celebración
function celebrateWin() {
    const cells = document.querySelectorAll('.cell');
    cells.forEach((cell, index) => {
        setTimeout(() => {
            cell.classList.add('success');
            setTimeout(() => cell.classList.remove('success'), 600);
        }, index * 30);
    });
}

// Nuevo juego
document.getElementById('newGameBtn').addEventListener('click', () => {
    lockedCells.clear();
    constraints = [];
    history = [];
    grid = Array(GRID_SIZE).fill().map(() => Array(GRID_SIZE).fill(STATES.EMPTY));
    init();
    clearMessage();
    updateUndoButton();
    sounds.click();
});

// Deshacer
document.getElementById('undoBtn').addEventListener('click', () => {
    undo();
});

// Reiniciar el juego
document.getElementById('resetBtn').addEventListener('click', () => {
    // Reiniciar solo las celdas no bloqueadas
    for (let row = 0; row < GRID_SIZE; row++) {
        for (let col = 0; col < GRID_SIZE; col++) {
            const cellKey = `${row}-${col}`;
            if (!lockedCells.has(cellKey)) {
                grid[row][col] = STATES.EMPTY;
            }
        }
    }
    history = [];
    updateGrid();
    clearMessage();
    updateUndoButton();
    sounds.click();
});

// Control de volumen
document.getElementById('volumeBtn').addEventListener('click', () => {
    isMuted = !isMuted;
    const volumeBtn = document.getElementById('volumeBtn');
    const icon = volumeBtn.querySelector('.icon');
    
    if (isMuted) {
        icon.textContent = '🔇';
        volumeBtn.classList.add('muted');
    } else {
        icon.textContent = '🔊';
        volumeBtn.classList.remove('muted');
        sounds.click();
    }
});

// Control de tema
document.getElementById('themeBtn').addEventListener('click', () => {
    currentTheme = currentTheme === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', currentTheme);
    
    const themeBtn = document.getElementById('themeBtn');
    const icon = themeBtn.querySelector('.icon');
    icon.textContent = currentTheme === 'dark' ? '☀️' : '🌙';
    
    sounds.click();
    
    // Guardar preferencia en localStorage
    localStorage.setItem('theme', currentTheme);
});

// Control del modal de información
document.getElementById('infoBtn').addEventListener('click', () => {
    const modal = document.getElementById('infoModal');
    modal.classList.add('show');
    sounds.click();
});

document.getElementById('closeInfoBtn').addEventListener('click', () => {
    const modal = document.getElementById('infoModal');
    modal.classList.remove('show');
});

// Cerrar modal al hacer clic fuera
document.getElementById('infoModal').addEventListener('click', (e) => {
    if (e.target.id === 'infoModal') {
        e.target.classList.remove('show');
    }
});

// Control del modal de victoria
function showVictoryModal() {
    const modal = document.getElementById('victoryModal');
    modal.classList.add('show');
}

function closeVictoryModal() {
    const modal = document.getElementById('victoryModal');
    modal.classList.remove('show');
}

document.getElementById('closeVictoryBtn').addEventListener('click', () => {
    closeVictoryModal();
});

document.getElementById('playAgainBtn').addEventListener('click', () => {
    closeVictoryModal();
    // Reiniciar con nuevo puzzle
    lockedCells.clear();
    constraints = [];
    grid = Array(GRID_SIZE).fill().map(() => Array(GRID_SIZE).fill(STATES.EMPTY));
    init();
    clearMessage();
    sounds.click();
});

// Cerrar modal de victoria al hacer clic fuera
document.getElementById('victoryModal').addEventListener('click', (e) => {
    if (e.target.id === 'victoryModal') {
        closeVictoryModal();
    }
});

// Cargar tema guardado
function loadTheme() {
    const savedTheme = localStorage.getItem('theme') || 'light';
    currentTheme = savedTheme;
    document.documentElement.setAttribute('data-theme', currentTheme);
    
    const themeBtn = document.getElementById('themeBtn');
    if (themeBtn) {
        const icon = themeBtn.querySelector('.icon');
        icon.textContent = currentTheme === 'dark' ? '☀️' : '🌙';
    }
}

// Generar puzzle aleatorio con solución
function generateRandomPuzzle() {
    // Primero, generar una solución válida
    const solution = generateValidSolution();
    
    // Copiar la solución al grid
    for (let row = 0; row < GRID_SIZE; row++) {
        for (let col = 0; col < GRID_SIZE; col++) {
            grid[row][col] = solution[row][col];
        }
    }
    
    // Generar restricciones (entre 3 y 6 para no saturar)
    const numConstraints = Math.floor(Math.random() * 4) + 3; // 3-6 restricciones
    constraints = [];
    
    // Crear lista de posibles restricciones interiores
    const possibleConstraints = [];
    
    // Restricciones horizontales (solo en filas interiores 1-4)
    for (let row = 1; row < GRID_SIZE - 1; row++) {
        for (let col = 0; col < GRID_SIZE - 1; col++) {
            possibleConstraints.push({
                row1: row,
                col1: col,
                row2: row,
                col2: col + 1,
                isHorizontal: true
            });
        }
    }
    
    // Restricciones verticales (solo en columnas interiores 1-4)
    for (let row = 0; row < GRID_SIZE - 1; row++) {
        for (let col = 1; col < GRID_SIZE - 1; col++) {
            possibleConstraints.push({
                row1: row,
                col1: col,
                row2: row + 1,
                col2: col,
                isHorizontal: false
            });
        }
    }
    
    // Mezclar y seleccionar restricciones sin solapamiento
    const usedPositions = new Set();
    
    while (constraints.length < numConstraints && possibleConstraints.length > 0) {
        const randomIndex = Math.floor(Math.random() * possibleConstraints.length);
        const constraint = possibleConstraints.splice(randomIndex, 1)[0];
        
        // Crear identificador único para esta posición
        const posId = `${constraint.row1}-${constraint.col1}-${constraint.row2}-${constraint.col2}`;
        
        // Verificar que no esté muy cerca de otra restricción
        const tooClose = Array.from(usedPositions).some(pos => {
            const [r1, c1, r2, c2] = pos.split('-').map(Number);
            // Verificar si comparten alguna celda
            return (constraint.row1 === r1 && constraint.col1 === c1) ||
                   (constraint.row1 === r2 && constraint.col1 === c2) ||
                   (constraint.row2 === r1 && constraint.col2 === c1) ||
                   (constraint.row2 === r2 && constraint.col2 === c2);
        });
        
        if (!tooClose) {
            const val1 = solution[constraint.row1][constraint.col1];
            const val2 = solution[constraint.row2][constraint.col2];
            const type = val1 === val2 ? CONSTRAINT_TYPES.EQUAL : CONSTRAINT_TYPES.DIFFERENT;
            
            constraints.push({
                row1: constraint.row1,
                col1: constraint.col1,
                row2: constraint.row2,
                col2: constraint.col2,
                type: type
            });
            
            usedPositions.add(posId);
        }
    }
    
    // Bloquear algunas celdas iniciales (entre 0 y 12)
    const numLocked = Math.floor(Math.random() * 13);
    lockedCells.clear();
    
    const availableCells = [];
    for (let row = 0; row < GRID_SIZE; row++) {
        for (let col = 0; col < GRID_SIZE; col++) {
            availableCells.push({ row, col });
        }
    }
    
    // Mezclar y seleccionar
    for (let i = 0; i < numLocked && availableCells.length > 0; i++) {
        const randomIndex = Math.floor(Math.random() * availableCells.length);
        const cell = availableCells.splice(randomIndex, 1)[0];
        lockedCells.add(`${cell.row}-${cell.col}`);
    }
    
    // Limpiar celdas no bloqueadas
    for (let row = 0; row < GRID_SIZE; row++) {
        for (let col = 0; col < GRID_SIZE; col++) {
            const cellKey = `${row}-${col}`;
            if (!lockedCells.has(cellKey)) {
                grid[row][col] = STATES.EMPTY;
            }
        }
    }
}

// Generar una solución válida usando backtracking
function generateValidSolution() {
    const solution = Array(GRID_SIZE).fill().map(() => Array(GRID_SIZE).fill(STATES.EMPTY));
    
    function isValid(row, col, value) {
        // Verificar conteos en la fila
        let rowSuns = 0, rowMoons = 0;
        for (let c = 0; c < GRID_SIZE; c++) {
            if (solution[row][c] === STATES.SUN) rowSuns++;
            if (solution[row][c] === STATES.MOON) rowMoons++;
        }
        if (value === STATES.SUN && rowSuns >= REQUIRED_COUNT) return false;
        if (value === STATES.MOON && rowMoons >= REQUIRED_COUNT) return false;
        
        // Verificar conteos en la columna
        let colSuns = 0, colMoons = 0;
        for (let r = 0; r < GRID_SIZE; r++) {
            if (solution[r][col] === STATES.SUN) colSuns++;
            if (solution[r][col] === STATES.MOON) colMoons++;
        }
        if (value === STATES.SUN && colSuns >= REQUIRED_COUNT) return false;
        if (value === STATES.MOON && colMoons >= REQUIRED_COUNT) return false;
        
        // Verificar consecutivos horizontales
        if (col >= 2 && solution[row][col-1] === value && solution[row][col-2] === value) return false;
        if (col >= 1 && col < GRID_SIZE - 1 && solution[row][col-1] === value && solution[row][col+1] === value) return false;
        
        // Verificar consecutivos verticales
        if (row >= 2 && solution[row-1][col] === value && solution[row-2][col] === value) return false;
        if (row >= 1 && row < GRID_SIZE - 1 && solution[row-1][col] === value && solution[row+1][col] === value) return false;
        
        return true;
    }
    
    function solve(pos) {
        if (pos === GRID_SIZE * GRID_SIZE) {
            return true;
        }
        
        const row = Math.floor(pos / GRID_SIZE);
        const col = pos % GRID_SIZE;
        
        const values = [STATES.SUN, STATES.MOON];
        // Mezclar para más variedad
        if (Math.random() < 0.5) values.reverse();
        
        for (const value of values) {
            if (isValid(row, col, value)) {
                solution[row][col] = value;
                if (solve(pos + 1)) {
                    return true;
                }
                solution[row][col] = STATES.EMPTY;
            }
        }
        
        return false;
    }
    
    solve(0);
    return solution;
}

// Iniciar el juego cuando se carga la página
window.addEventListener('DOMContentLoaded', () => {
    loadTheme();
    init();
});
