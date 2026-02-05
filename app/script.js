const codeInput = document.getElementById("codeInput");
const lineNumbers = document.getElementById("lineNumbers");
const languageSelect = document.getElementById("languageSelect");
const runBtn = document.getElementById("runBtn");
const debugBtn = document.getElementById("debugBtn");
const autoDebugBtn = document.getElementById("autoDebugBtn");
const pauseBtn = document.getElementById("pauseBtn");
const resetBtn = document.getElementById("resetBtn");
const speedRange = document.getElementById("speedRange");
const speedLabel = document.getElementById("speedLabel");
const stepsEl = document.getElementById("steps");
const statusEl = document.getElementById("status");
const stageLine = document.getElementById("stageLine");
const stageVars = document.getElementById("stageVars");
const stageStack = document.getElementById("stageStack");

const defaultSnippets = {
  java: `public class Main {\n  public static void main(String[] args) {\n    int total = 2 + 3;\n    String name = "Ada";\n    greet(name);\n    total = total + 4;\n  }\n\n  static void greet(String who) {\n    String message = "Hello, " + who;\n  }\n}`,
  python: `def greet(who):\n    message = "Hello, " + who\n\nif __name__ == "__main__":\n    total = 2 + 3\n    name = "Ada"\n    greet(name)\n    total = total + 4\n`,
  javascript: `function greet(who) {\n  const message = "Hello, " + who;\n}\n\nfunction main() {\n  let total = 2 + 3;\n  let name = "Ada";\n  greet(name);\n  total = total + 4;\n}\n\nmain();\n`,
  go: `package main\n\nimport "fmt"\n\nfunc greet(who string) {\n  message := "Hello, " + who\n  _ = message\n}\n\nfunc main() {\n  total := 2 + 3\n  name := "Ada"\n  greet(name)\n  total = total + 4\n  fmt.Println(total)\n}\n`
};

let steps = [];
let stepIndex = 0;
let debugMode = false;
let runTimer = null;
let isRunning = false;
let debugTimer = null;
let isDebugAutoRunning = false;
let debugAutoEnabled = false;
let lastVars = {};
let lastStack = [];

function setDefaultCode() {
  const lang = languageSelect.value;
  codeInput.value = defaultSnippets[lang];
  updateLineNumbers();
}

function updateLineNumbers() {
  const lineCount = codeInput.value.split("\n").length || 1;
  let nums = "";
  for (let i = 1; i <= lineCount; i += 1) {
    nums += `${i}\n`;
  }
  lineNumbers.textContent = nums;
}

function tokenizeLines(code) {
  return code.split("\n").map((text, index) => ({
    text,
    number: index + 1,
  }));
}

function isIgnorable(line) {
  const trimmed = line.trim();
  return (
    trimmed.length === 0 ||
    trimmed.startsWith("//") ||
    trimmed.startsWith("#") ||
    trimmed.startsWith("/*") ||
    trimmed.startsWith("*")
  );
}

function detectFunctionDef(line, language) {
  const trimmed = line.trim();
  if (language === "python") {
    const match = trimmed.match(/^def\s+([a-zA-Z_][\w]*)\s*\(/);
    return match ? match[1] : null;
  }
  if (language === "go") {
    const match = trimmed.match(/^func\s+([a-zA-Z_][\w]*)\s*\(/);
    return match ? match[1] : null;
  }
  if (language === "javascript") {
    const match = trimmed.match(/^function\s+([a-zA-Z_][\w]*)\s*\(/);
    return match ? match[1] : null;
  }
  const match = trimmed.match(/^(public\s+)?(static\s+)?([a-zA-Z_][\w<>\[\]]*)\s+([a-zA-Z_][\w]*)\s*\(/);
  return match ? match[4] : null;
}

function detectCall(line) {
  const trimmed = line.trim();
  if (trimmed.includes("=") && trimmed.includes("==")) {
    return null;
  }
  const match = trimmed.match(/([a-zA-Z_][\w]*)\s*\(/);
  if (!match) {
    return null;
  }
  const name = match[1];
  const ignored = ["if", "for", "while", "switch", "return", "catch", "def", "function", "func"];
  if (ignored.includes(name)) {
    return null;
  }
  return name;
}

function parseAssignment(line) {
  const trimmed = line.trim();
  const assignmentMatch = trimmed.match(/^(?:[a-zA-Z_][\w<>\[\]]*\s+)?([a-zA-Z_][\w]*)\s*(=|:=)\s*(.+?);?$/);
  if (!assignmentMatch) {
    return null;
  }
  return {
    name: assignmentMatch[1],
    value: assignmentMatch[3].trim(),
  };
}

function normalizeValue(value) {
  if (/^[-+]?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }
  if (/^".*"$/.test(value) || /^'.*'$/.test(value)) {
    return value.slice(1, -1);
  }
  if (value === "true" || value === "false") {
    return value === "true";
  }
  return `expr(${value})`;
}

function buildExecutionSteps(code, language) {
  const lines = tokenizeLines(code);
  const vars = {};
  const stack = ["<entry>"];
  const stepsLocal = [];

  lines.forEach((line) => {
    if (isIgnorable(line.text)) {
      return;
    }

    const functionDef = detectFunctionDef(line.text, language);
    if (functionDef) {
      stepsLocal.push({
        line,
        vars: { ...vars },
        stack: [...stack],
        note: `defined function ${functionDef}()`,
      });
      return;
    }

    const assignment = parseAssignment(line.text);
    if (assignment) {
      vars[assignment.name] = normalizeValue(assignment.value);
      stepsLocal.push({
        line,
        vars: { ...vars },
        stack: [...stack],
        note: `set ${assignment.name}`,
      });
      return;
    }

    if (line.text.trim().startsWith("return")) {
      const last = stack.length > 1 ? stack.pop() : stack[0];
      stepsLocal.push({
        line,
        vars: { ...vars },
        stack: [...stack],
        note: `return from ${last}`,
      });
      return;
    }

    const call = detectCall(line.text);
    if (call) {
      stack.push(`${call}()`);
      stepsLocal.push({
        line,
        vars: { ...vars },
        stack: [...stack],
        note: `call ${call}()`,
      });
      stack.pop();
      return;
    }

    stepsLocal.push({
      line,
      vars: { ...vars },
      stack: [...stack],
      note: "execute line",
    });
  });

  return stepsLocal;
}

function renderCurrent(step) {
  if (!step) {
    stageLine.textContent = "-";
    stageVars.innerHTML = "";
    stageStack.innerHTML = "";
    return;
  }

  renderStage(step);
}

function renderSteps(activeIndex) {
  stepsEl.innerHTML = "";
  steps.forEach((step, index) => {
    const item = document.createElement("li");
    item.textContent = `${step.line.number}: ${step.note}`;
    if (index === activeIndex) {
      item.classList.add("active");
    }
    if (index >= Math.max(0, activeIndex - 3) && index <= activeIndex) {
      item.classList.add("enter");
    }
    stepsEl.appendChild(item);
  });

}

function renderStage(step) {
  stageLine.textContent = `${step.line.number}: ${step.line.text.trim()}`;

  stageVars.innerHTML = "";
  const entries = Object.entries(step.vars);
  if (entries.length === 0) {
    stageVars.innerHTML = "<div class=\"panel-meta\">No vars</div>";
  } else {
    entries.forEach(([key, value]) => {
      const chip = document.createElement("div");
      chip.className = "stage-chip";
      chip.innerHTML = `<span>${key}</span><span>${String(value)}</span>`;
      if (lastVars[key] !== value) {
        chip.classList.add("grow");
      }
      stageVars.appendChild(chip);
    });
  }

  stageStack.innerHTML = "";
  step.stack.slice().reverse().forEach((frame, index) => {
    const chip = document.createElement("div");
    chip.className = "stage-chip";
    chip.classList.add(`depth-${Math.min(index, 4)}`);
    chip.textContent = frame;
    stageStack.appendChild(chip);
  });

  lastVars = { ...step.vars };
  lastStack = [...step.stack];
}


function runAll() {
  steps = buildExecutionSteps(codeInput.value, languageSelect.value);
  if (steps.length === 0) {
    statusEl.textContent = "No executable lines found.";
    renderCurrent(null);
    renderSteps(-1);
    return;
  }

  if (runTimer) {
    clearInterval(runTimer);
  }

  isRunning = true;
  setControlsState();
  stepIndex = 0;
  renderCurrent(steps[stepIndex]);
  renderSteps(stepIndex);
  statusEl.textContent = `Running: step ${stepIndex + 1} of ${steps.length}.`;

  runTimer = setInterval(() => {
    if (stepIndex < steps.length - 1) {
      stepIndex += 1;
      renderCurrent(steps[stepIndex]);
      renderSteps(stepIndex);
      statusEl.textContent = `Running: step ${stepIndex + 1} of ${steps.length}.`;
    } else {
      clearInterval(runTimer);
      runTimer = null;
      isRunning = false;
      setControlsState();
      statusEl.textContent = `Completed ${steps.length} steps.`;
    }
  }, getRunDelay());
}

function startDebug() {
  steps = buildExecutionSteps(codeInput.value, languageSelect.value);
  if (steps.length === 0) {
    statusEl.textContent = "No executable lines found.";
    renderCurrent(null);
    renderSteps(-1);
    return;
  }
  debugMode = true;
  setControlsState();
  stepIndex = 0;
  renderCurrent(steps[stepIndex]);
  renderSteps(stepIndex);
  statusEl.textContent = `Debugging: step ${stepIndex + 1} of ${steps.length}.`;

  if (debugAutoEnabled) {
    resumeDebugAuto();
  }
}

function advanceDebug() {
  if (!debugMode || steps.length === 0) {
    return;
  }
  if (stepIndex < steps.length - 1) {
    stepIndex += 1;
    renderCurrent(steps[stepIndex]);
    renderSteps(stepIndex);
    statusEl.textContent = `Debugging: step ${stepIndex + 1} of ${steps.length}.`;
  } else {
    statusEl.textContent = "Debug complete.";
    debugMode = false;
    isDebugAutoRunning = false;
    if (debugTimer) {
      clearInterval(debugTimer);
      debugTimer = null;
    }
    setControlsState();
  }
}

function resumeDebugAuto() {
  if (!debugMode || steps.length === 0 || isDebugAutoRunning) {
    return;
  }
  isDebugAutoRunning = true;
  setControlsState();
  debugTimer = setInterval(() => {
    if (stepIndex < steps.length - 1) {
      stepIndex += 1;
      renderCurrent(steps[stepIndex]);
      renderSteps(stepIndex);
      statusEl.textContent = `Debugging: step ${stepIndex + 1} of ${steps.length}.`;
    } else {
      clearInterval(debugTimer);
      debugTimer = null;
      isDebugAutoRunning = false;
      debugMode = false;
      statusEl.textContent = "Debug complete.";
      setControlsState();
    }
  }, getRunDelay());
}

function pauseDebugAuto() {
  if (!isDebugAutoRunning) {
    return;
  }
  clearInterval(debugTimer);
  debugTimer = null;
  isDebugAutoRunning = false;
  setControlsState();
  statusEl.textContent = `Paused at step ${stepIndex + 1} of ${steps.length}.`;
}

function pauseRun() {
  if (!isRunning) {
    return;
  }
  clearInterval(runTimer);
  runTimer = null;
  isRunning = false;
  setControlsState();
  statusEl.textContent = `Paused at step ${stepIndex + 1} of ${steps.length}.`;
}

function resumeRun() {
  if (isRunning || steps.length === 0) {
    return;
  }
  isRunning = true;
  setControlsState();
  statusEl.textContent = `Running: step ${stepIndex + 1} of ${steps.length}.`;
  runTimer = setInterval(() => {
    if (stepIndex < steps.length - 1) {
      stepIndex += 1;
      renderCurrent(steps[stepIndex]);
      renderSteps(stepIndex);
      statusEl.textContent = `Running: step ${stepIndex + 1} of ${steps.length}.`;
    } else {
      clearInterval(runTimer);
      runTimer = null;
      isRunning = false;
      setControlsState();
      statusEl.textContent = `Completed ${steps.length} steps.`;
    }
  }, getRunDelay());
}

function getRunDelay() {
  return Number(speedRange.value);
}

function isRunPaused() {
  return !isRunning && steps.length > 0 && !debugMode;
}

function isDebugPaused() {
  return debugMode && debugAutoEnabled && !isDebugAutoRunning && stepIndex < steps.length - 1;
}

function setControlsState() {
  runBtn.disabled = isRunning || debugMode;
  debugBtn.disabled = isRunning || isDebugAutoRunning;
  autoDebugBtn.disabled = isRunning;
  autoDebugBtn.querySelector(".toggle-state").textContent = debugAutoEnabled ? "On" : "Off";
  autoDebugBtn.setAttribute("aria-pressed", debugAutoEnabled ? "true" : "false");
  autoDebugBtn.classList.toggle("active", debugAutoEnabled);
  debugBtn.textContent = debugAutoEnabled ? "Auto Step" : "Step";
  pauseBtn.disabled = !(isRunning || isDebugAutoRunning || isRunPaused() || isDebugPaused());
  pauseBtn.textContent = isRunning || isDebugAutoRunning ? "Pause" : "Resume";
}

function resetAll() {
  debugMode = false;
  if (runTimer) {
    clearInterval(runTimer);
    runTimer = null;
  }
  isRunning = false;
  if (debugTimer) {
    clearInterval(debugTimer);
    debugTimer = null;
  }
  isDebugAutoRunning = false;
  steps = [];
  stepIndex = 0;
  lastVars = {};
  lastStack = [];
  renderCurrent(null);
  renderSteps(-1);
  statusEl.textContent = "Ready.";
  setControlsState();
}

codeInput.addEventListener("input", updateLineNumbers);
let scrollHideTimer = null;
codeInput.addEventListener("scroll", () => {
  lineNumbers.scrollTop = codeInput.scrollTop;
  codeInput.classList.add("scrolling");
  if (scrollHideTimer) {
    clearTimeout(scrollHideTimer);
  }
  scrollHideTimer = setTimeout(() => {
    codeInput.classList.remove("scrolling");
  }, 600);
});

languageSelect.addEventListener("change", () => {
  setDefaultCode();
  resetAll();
});

runBtn.addEventListener("click", () => {
  debugMode = false;
  runAll();
});

debugBtn.addEventListener("click", () => {
  if (!debugMode) {
    startDebug();
  } else if (!debugAutoEnabled) {
    advanceDebug();
  } else {
    resumeDebugAuto();
  }
});

autoDebugBtn.addEventListener("click", () => {
  debugAutoEnabled = !debugAutoEnabled;
  if (debugAutoEnabled) {
    resumeDebugAuto();
  } else {
    pauseDebugAuto();
  }
  setControlsState();
});

pauseBtn.addEventListener("click", () => {
  if (isRunning) {
    pauseRun();
    return;
  } else {
    if (isRunPaused()) {
      resumeRun();
      return;
    }
  }

  if (isDebugAutoRunning) {
    pauseDebugAuto();
    return;
  }

  if (isDebugPaused()) {
    resumeDebugAuto();
    return;
  }
});

resetBtn.addEventListener("click", () => {
  resetAll();
});

speedRange.addEventListener("input", () => {
  speedLabel.textContent = `${speedRange.value} ms`;
  if (isRunning) {
    pauseRun();
    resumeRun();
  }

  if (isDebugAutoRunning) {
    pauseDebugAuto();
    resumeDebugAuto();
  }
});

setDefaultCode();
setControlsState();
