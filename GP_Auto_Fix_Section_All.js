
(() => {
if (window.__gpV3) {
    alert("GP Auto-Fix is already running.");
    return;
}

const S = window.__gpV3 = {
    phase: "idle",
    current: "",
    name: "",
    targetStart: 0,
    done: [],
    failed: [],
    paused: false,
    stopped: false,
    busy: false,
    started: false,
    pageBefore: 0,
    sectionReady: false,
    skipReason: "",
    tempAdjustment: null
};

const wait = ms => new Promise(r => setTimeout(r, ms));

const SKIP_KEY = "udise_gp_invalid_students_v1";
const ADJUST_KEY = "udise_gp_temporary_mobile_adjustments_v1";

let skipList = [];
let adjustmentList = [];

try {
    skipList = JSON.parse(localStorage.getItem(SKIP_KEY) || "[]");
} catch (_) {}

try {
    adjustmentList = JSON.parse(localStorage.getItem(ADJUST_KEY) || "[]");
} catch (_) {}

if (!Array.isArray(skipList)) skipList = [];
if (!Array.isArray(adjustmentList)) adjustmentList = [];

const isSkipped = pen =>
    skipList.some(x =>
        String(x.pen) === String(pen) &&
        x.type !== "temporary_mobile_adjustment"
    );

function saveSkipList() {
    try {
        localStorage.setItem(SKIP_KEY, JSON.stringify(skipList));
    } catch (e) {
        console.warn(e);
    }
}

function saveAdjustments() {
    try {
        localStorage.setItem(ADJUST_KEY, JSON.stringify(adjustmentList));
    } catch (e) {
        console.warn(e);
    }
}

function exportSkipList() {
    const data = [...skipList, ...adjustmentList];
    const blob = new Blob(
        [JSON.stringify(data, null, 2)],
        { type: "application/json" }
    );

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "GP_Invalid_Students.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
}

const panel = document.createElement("div");

panel.style.cssText =
    "position:fixed;right:15px;top:100px;width:300px;" +
    "z-index:999999;background:#172b40;color:white;" +
    "padding:14px;border-radius:10px;font:13px Arial;" +
    "box-shadow:0 3px 15px #0008;max-height:80vh;overflow:auto";

panel.innerHTML = `
<b style="font-size:16px">UDISE+ GP Auto-Fix v3</b>
<hr>
<div style="margin-bottom:8px">
    <label>Select Section:</label>
    <select id="gpSection"
        style="width:100%;padding:7px;margin-top:5px">
        <option value="">Select section...</option>
    </select>
</div>
<button id="gpStart"
    style="background:#16803c;color:white;padding:8px;width:100%">
    START
</button>
<hr>
<div id="gpStatus"></div>
<div style="margin-top:12px">
    <button id="gpPause">Pause</button>
    <button id="gpStop">Stop</button>
    <button id="gpExport">Export JSON</button>
    <button id="gpImport">Load JSON</button>
    <input id="gpFile" type="file"
        accept=".json,application/json" style="display:none">
</div>
<div id="gpLog"
    style="margin-top:10px;max-height:200px;overflow:auto"></div>
`;

document.body.appendChild(panel);

const status = panel.querySelector("#gpStatus");
const log = panel.querySelector("#gpLog");
const sectionPicker = panel.querySelector("#gpSection");
const startButton = panel.querySelector("#gpStart");

function say(msg) {
    const d = document.createElement("div");
    d.textContent = msg;
    d.style.cssText = "padding:4px;border-bottom:1px solid #456";
    log.prepend(d);

    status.innerHTML =
        `Completed: ${S.done.length}<br>` +
        `Failed: ${S.failed.length}<br>` +
        `ER1065 logged: ${skipList.filter(x => x.type === "er1065").length}<br>` +
        `Temporary adjustments: ${adjustmentList.length}<br>` +
        `Current PEN: ${S.current || "-"}<br>` +
        `Page start: ${S.targetStart || "-"}<br>` +
        `Status: ${S.phase}`;
}

function loadSectionOptions() {
    const source = document.querySelector("select.form-select.w150");

    if (!source) {
        sectionPicker.innerHTML =
            '<option value="">Section dropdown not found</option>';
        startButton.disabled = true;
        say("Could not find the website section dropdown.");
        return;
    }

    sectionPicker.innerHTML =
        '<option value="">Select section...</option>';

    [...source.options].forEach(option => {
        const item = document.createElement("option");
        item.value = option.value;
        item.textContent = option.textContent.trim();
        sectionPicker.appendChild(item);
    });

    sectionPicker.value = "";
    say("Choose a section, then press START.");
}

loadSectionOptions();

function rangeStart() {
    const t = document.querySelector(
        "mat-paginator .mat-mdc-paginator-range-label"
    )?.innerText || "";

    const m = t.match(/(\d+)\s*[–-]/);
    return m ? Number(m[1]) : 0;
}

function rows() {
    return [...document.querySelectorAll("tr.mat-mdc-row")];
}

function findRow(pen) {
    return rows().find(r =>
        r.querySelector("td.mat-column-code")
            ?.innerText.trim() === String(pen)
    );
}

function getGP(row) {
    return [...(row?.querySelectorAll(
        "td.mat-column-updateDet a"
    ) || [])].find(a => a.innerText.trim() === "GP");
}

function isGPPage() {
    return !!(
        document.getElementById("address") &&
        document.getElementById("motherTongue")
    );
}

function setValue(el, value) {
    if (!el) return false;

    const proto = el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : el instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : el instanceof HTMLInputElement
        ? HTMLInputElement.prototype
        : Object.getPrototypeOf(el);

    const setter = Object.getOwnPropertyDescriptor(
        proto, "value"
    )?.set;

    if (setter) setter.call(el, value);
    else el.value = value;

    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
}

function addFailed(pen, reason) {
    if (!pen) return;

    const item = {
        pen: String(pen),
        name: S.name || "",
        reason: String(reason || "Failed")
    };

    if (!S.failed.some(x => String(x.pen) === String(pen))) {
        S.failed.push(item);
    }

    if (!isSkipped(pen)) {
        skipList.push({
            ...item,
            added: new Date().toISOString()
        });
    }

    saveSkipList();
}

function recordTemporaryMobile(pen, original, adjusted, retryStatus) {
    const item = {
        type: "temporary_mobile_adjustment",
        pen: String(pen),
        name: S.name || "",
        reason: "ER1065 - Temporary mobile adjustment",
        originalMobile: original,
        adjustedMobile: adjusted,
        retryStatus,
        added: new Date().toISOString()
    };

    const index = adjustmentList.findIndex(
        x => String(x.pen) === String(pen)
    );

    if (index >= 0) adjustmentList[index] = item;
    else adjustmentList.push(item);

    saveAdjustments();
    S.tempAdjustment = item;

    say("Temporary mobile adjustment logged.");
}

function updateTemporaryStatus(pen, result) {
    const item = adjustmentList.find(
        x => String(x.pen) === String(pen)
    );

    if (item) {
        item.retryStatus = result;
        item.verifiedAt = new Date().toISOString();
        saveAdjustments();
    }
}

function recordER1065(pen, mobile) {
    const key = String(pen);
    const existing = skipList.find(
        x => String(x.pen) === key && x.type === "er1065"
    );

    if (existing) {
        existing.occurrences = (Number(existing.occurrences) || 1) + 1;
        existing.lastSeen = new Date().toISOString();
        existing.mobile = mobile || existing.mobile || "";
    } else {
        skipList.push({
            type: "er1065",
            pen: key,
            name: S.name || "",
            mobile: mobile || "",
            reason: "ER1065 - mobile number already registered with 5 students",
            occurrences: 1,
            added: new Date().toISOString(),
            lastSeen: new Date().toISOString()
        });
    }

    saveSkipList();
    say("ER1065 logged for PEN " + key + "; mobile: " + (mobile || "not available"));
}

function incrementLastDigit(value) {
    const v = String(value || "").trim();

    if (!/\d$/.test(v)) {
        throw Error("Primary mobile number has no final digit");
    }

    return v.replace(/\d$/, d => String((Number(d) + 1) % 10));
}

function hasER1065() {
    const t = document.body.innerText || "";
    return /\bER1065\b/i.test(t) ||
        /already registered with 5 students/i.test(t);
}

function dismissErrorMessage() {
    const t = document.querySelector(
        ".swal2-confirm, .swal2-close, " +
        ".modal.show .btn-close, " +
        ".modal.show button[data-bs-dismiss='modal']"
    );

    if (t) {
        t.click();
        return true;
    }

    return false;
}

function skipStudent(reason) {
    const pen = S.current;

    addFailed(pen, reason);
    say("SKIPPING " + pen + ": " + reason);

    S.phase = "returning";
    S.skipReason = reason;

    if (isGPPage()) {
        setTimeout(() => history.back(), 700);
    }
}

async function fixStudent() {
    if (S.busy || S.phase !== "opening") return;

    S.busy = true;
    S.phase = "editing";
    S.tempAdjustment = null;

    say("Editing: " + S.name);

    try {
        // 1. ADDRESS CLEANING
        const a = document.getElementById("address");

        if (!a) throw Error("Address field missing");

        setValue(a, a.value.trim().replace(/\s+/g, " "));

        // 2. MOBILE NUMBER FIXING
        const b = document.getElementById("phoneNo");
        const c = document.getElementById("secondaryMobile");

        if (b && c) {
            const primary = b.value.trim();
            const alternate = c.value.trim();

            if (!primary && alternate) {
                setValue(b, alternate);
                setValue(c, "");
                say("Alternate copied to primary and cleared");

            } else if (
                primary &&
                alternate &&
                primary === alternate
            ) {
                setValue(c, "");
                say("Duplicate alternate number cleared");

            } else if (primary && alternate) {
                say("Different mobile numbers retained");

            } else {
                say("Mobile numbers checked");
            }
        } else {
            say("Primary or alternate mobile field not found");
        }

        // 3. CLEAR EMAIL
        document.querySelectorAll(
            'input[type="email"],' +
            'input[id*="email" i],' +
            'input[name*="email" i],' +
            'input[formcontrolname*="email" i],' +
            'textarea[id*="email" i],' +
            'textarea[name*="email" i],' +
            'textarea[formcontrolname*="email" i]'
        ).forEach(el => setValue(el, ""));

        say("Email field cleared");

        // 4. MOTHER TONGUE: 3-BENGALI
        const f = document.getElementById("motherTongue");

        if (!f) throw Error("Mother Tongue field missing");

        const g = f.querySelector(".ng-select-container");

        if (g) {
            g.dispatchEvent(new MouseEvent("mousedown", {
                bubbles: true,
                cancelable: true
            }));

            g.dispatchEvent(new MouseEvent("click", {
                bubbles: true,
                cancelable: true
            }));
        }

        await wait(200);

        let selected = null;

        document.querySelectorAll(
            ".ng-dropdown-panel .ng-option"
        ).forEach(option => {
            const value = option.innerText || option.textContent || "";

            if (value.toLowerCase().includes("3-bengali")) {
                selected = option;
            }
        });

        if (!selected) throw Error("3-Bengali option missing");

        selected.click();
        await wait(150);

        // 5. BLOOD GROUP: INVESTIGATION
        const m =
            document.getElementById("bloodGroup") ||
            document.querySelector(
                'select[formcontrolname="bloodGroup"]'
            );

        if (m) {
            let found = false;

            for (let n = 0; n < m.options.length; n++) {
                if (
                    m.options[n].text.toLowerCase()
                        .includes("investigation")
                ) {
                    m.selectedIndex = n;
                    found = true;
                    break;
                }
            }

            if (!found) throw Error("Investigation option missing");

            m.dispatchEvent(new Event("change", { bubbles: true }));
        } else {
            throw Error("Blood Group field missing");
        }

        await wait(300);

        // 6. SUBMIT
        const submit =
            document.querySelector('button[type="submit"]') ||
            [...document.querySelectorAll("button")].find(
                p => /save|update/i.test(p.innerText)
            );

        if (!submit) throw Error("Submit button missing");

        S.phase = "saving";
        say("Submitting " + S.current);
        submit.click();

        // 7. CHECK ER1065 AFTER THIS SAVE ATTEMPT
        // Wait up to 12 seconds for the server validation response.
        let duplicateError = false;

        for (let i = 0; i < 48; i++) {
            await wait(250);

            if (hasER1065()) {
                duplicateError = true;
                break;
            }
        }

        // 8. LOG ER1065 AND SKIP THIS STUDENT; DO NOT ALTER CONTACT NUMBERS
        if (duplicateError) {
            const mobile = document.getElementById("phoneNo")?.value.trim() || "";
            recordER1065(S.current, mobile);
            dismissErrorMessage();
            skipStudent("ER1065: duplicate mobile number; logged for manual correction");
            return;
        }

        // 9. CLOSE MODAL AND RETURN
        let returned = false;

        function goBack() {
            if (returned) return;
            returned = true;
            S.phase = "returning";
            history.back();
        }

        const closeTimer = setInterval(() => {
            const t = document.querySelector(
                ".modal.show .btn-close, " +
                ".modal.show button[data-bs-dismiss='modal'], " +
                ".swal2-confirm, .swal2-close"
            );

            if (t) {
                t.click();
                clearInterval(closeTimer);
                setTimeout(goBack, 500);
            }
        }, 300);

        setTimeout(() => {
            clearInterval(closeTimer);
            goBack();
        }, 3500);

    } catch (e) {
        skipStudent(e.message || String(e));

    } finally {
        S.busy = false;
    }
}

async function restorePage() {
    const current = rangeStart();

    if (!current) return false;
    if (current === S.targetStart) return true;

    const next = document.querySelector(
        "mat-paginator button.mat-mdc-paginator-navigation-next"
    );

    const previous = document.querySelector(
        "mat-paginator button.mat-mdc-paginator-navigation-previous"
    );

    if (current < S.targetStart && next && !next.disabled) {
        next.click();

    } else if (
        current > S.targetStart &&
        previous &&
        !previous.disabled
    ) {
        previous.click();

    } else {
        skipStudent("Could not restore original page");
        return false;
    }

    say("Restoring list page...");
    await wait(1500);

    return rangeStart() === S.targetStart;
}

async function verifyStudent() {
    if (rangeStart() !== S.targetStart) {
        S.phase = "restoring";
        return;
    }

    const row = findRow(S.current);

    if (!row) {
        skipStudent("Student PEN not found after returning");
        return;
    }

    const gp = getGP(row);

    if (gp && gp.classList.contains("submit")) {
        S.done.push(S.current);
        say("SUCCESS: " + S.name);

        if (S.tempAdjustment) {
            updateTemporaryStatus(
                S.current,
                "GP saved successfully; temporary mobile needs correction"
            );

            say("Reminder: correct temporary mobile for " + S.current);
        }

    } else {
        addFailed(
            S.current,
            S.skipReason || "GP remains incomplete"
        );

        if (S.tempAdjustment) {
            updateTemporaryStatus(
                S.current,
                "GP not confirmed saved; check mobile number"
            );
        }

        say("FAILED: GP still red for " + S.current);
    }

    S.current = "";
    S.name = "";
    S.skipReason = "";
    S.tempAdjustment = null;
    S.phase = "idle";
}

async function tick() {
    if (!S.started || S.paused || S.stopped || S.busy) return;

    if (isGPPage()) {
        if (S.phase === "opening") {
            await fixStudent();
        }
        return;
    }

    if (!document.querySelector("mat-paginator")) return;

    if (S.phase === "returning") {
        if (rangeStart() !== S.targetStart) {
            S.phase = "restoring";
            return;
        }

        await verifyStudent();
        return;
    }

    if (S.phase === "restoring") {
        const restored = await restorePage();

        if (restored) S.phase = "returning";
        return;
    }

    if (S.phase === "paging") {
        if (rangeStart() !== S.pageBefore) {
            S.phase = "idle";
            say("Next page loaded");
        }
        return;
    }

    if (S.phase !== "idle") return;

    const current = rangeStart();
    if (!current) return;

    S.targetStart = current;

    // Find only RED / incomplete GP records
    for (const row of rows()) {
        const pen = row.querySelector(
            "td.mat-column-code"
        )?.innerText.trim();

        const gp = getGP(row);

        if (!pen || !gp) continue;
        if (!gp.classList.contains("incomplete")) continue;

        if (
            S.done.includes(pen) ||
            isSkipped(pen) ||
            S.failed.some(x => String(x.pen) === String(pen))
        ) {
            continue;
        }

        S.current = pen;

        S.name = row.querySelector(
            "td.mat-column-name"
        )?.innerText.trim() || "";

        S.phase = "opening";

        say("Opening RED GP: " + S.name);
        gp.click();
        return;
    }

    // No more incomplete GP records on this page
    const next = document.querySelector(
        "mat-paginator button.mat-mdc-paginator-navigation-next"
    );

    if (next && !next.disabled) {
        S.pageBefore = current;
        S.phase = "paging";

        say("Moving to next page...");
        next.click();

    } else {
        S.phase = "finished";
        S.stopped = true;
        clearInterval(timer);

        say("ALL PAGES CHECKED");
        say("Completed: " + S.done.length);
        say("Failed / permanently skipped: " + skipList.length);
        say("ER1065 records: " + skipList.filter(x => x.type === "er1065").length);
        say("Temporary adjustments: " + adjustmentList.length);

        if (skipList.length || adjustmentList.length) {
            say("Downloading GP_Invalid_Students.json...");
            exportSkipList();
        }

        console.table(S.failed);
        console.table(adjustmentList);

        startButton.innerText = "FINISHED";
    }
}

// START: apply the section selected by the user
startButton.onclick = async () => {
    if (S.started) return;

    const selected = sectionPicker.value;

    if (selected === "") {
        alert("Please select a section first.");
        return;
    }

    const source = document.querySelector(
        "select.form-select.w150"
    );

    if (!source) {
        alert("Website section dropdown not found.");
        return;
    }

    const selectedOption = sectionPicker.options[
        sectionPicker.selectedIndex
    ];

    const selectedName = selectedOption
        ? selectedOption.textContent.trim()
        : selected;

    source.value = selected;

    source.dispatchEvent(
        new Event("input", { bubbles: true })
    );

    source.dispatchEvent(
        new Event("change", { bubbles: true })
    );

    sectionPicker.disabled = true;
    startButton.disabled = true;
    startButton.innerText = "LOADING...";

    say("Selected section: " + selectedName);
    say("Waiting for student list to refresh...");

    // Wait for the section-filtered list
    await wait(1800);

    if (!document.querySelector("mat-paginator")) {
        sectionPicker.disabled = false;
        startButton.disabled = false;
        startButton.innerText = "START";
        say("Student list not detected. Please try START again.");
        return;
    }

    S.targetStart = rangeStart() || 1;
    S.sectionReady = true;
    S.started = true;
    S.phase = "idle";

    startButton.innerText = "RUNNING";

    say("Section ready: " + selectedName);
    say("Automation started");
    say("Only incomplete GP records will be processed.");
};

// Pause / Resume
panel.querySelector("#gpPause").onclick = () => {
    if (!S.started || S.stopped) return;

    S.paused = !S.paused;

    panel.querySelector("#gpPause").innerText =
        S.paused ? "Resume" : "Pause";

    say(S.paused ? "Paused" : "Resumed");
};

// Export JSON
panel.querySelector("#gpExport").onclick = exportSkipList;

// Import JSON
panel.querySelector("#gpImport").onclick = () =>
    panel.querySelector("#gpFile").click();

panel.querySelector("#gpFile").onchange = async e => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    try {
        const data = JSON.parse(await file.text());

        if (!Array.isArray(data)) {
            throw Error("JSON must contain an array");
        }

        let added = 0;
        let adjustments = 0;

        for (const x of data) {
            if (!x || !x.pen) continue;

            if (x.type === "temporary_mobile_adjustment") {
                const exists = adjustmentList.some(a =>
                    String(a.pen) === String(x.pen)
                );

                if (!exists) {
                    adjustmentList.push(x);
                    adjustments++;
                }

                continue;
            }

            if (!isSkipped(x.pen)) {
                skipList.push({
                    ...x,
                    pen: String(x.pen),
                    name: x.name || "",
                    reason: x.reason || "Imported skip",
                    added: x.added || new Date().toISOString()
                });

                added++;
            }
        }

        saveSkipList();
        saveAdjustments();

        say(
            "Imported " + added +
            " skipped students and " +
            adjustments + " temporary adjustments."
        );

    } catch (err) {
        alert("Could not load JSON: " + err.message);
    }

    e.target.value = "";
};

// STOP
panel.querySelector("#gpStop").onclick = () => {
    S.stopped = true;
    S.phase = "stopped";

    clearInterval(timer);

    say("Stopped by user");
    startButton.innerText = "STOPPED";
};

// Background timer: waits until START is pressed
const timer = setInterval(() => {
    tick().catch(e => {
        console.error("GP Auto-Fix error:", e);

        if (S.current) {
            skipStudent(e.message || String(e));
        } else {
            say("Error: " + (e.message || String(e)));
        }
    });
}, 900);

S.failed = skipList.map(x => ({
    pen: String(x.pen),
    name: x.name || "",
    reason: x.reason || "Previously failed"
}));

say("Loaded permanent skip list: " + skipList.length);
say("Loaded temporary adjustments: " + adjustmentList.length);
say("Waiting for section selection and START.");

})();
