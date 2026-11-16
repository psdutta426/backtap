
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
    pageBefore: 0,
    sectionReady: false,
    tempAdjustment: null
};

const wait = ms => new Promise(r => setTimeout(r, ms));

const SKIP_KEY = "udise_gp_invalid_students_v1";
const ADJUST_KEY = "udise_gp_temporary_mobile_adjustments_v1";

let skipList = [];
let adjustmentList = [];

try {
    skipList = JSON.parse(localStorage.getItem(SKIP_KEY) || "[]");
} catch (_) {
    skipList = [];
}

try {
    adjustmentList = JSON.parse(
        localStorage.getItem(ADJUST_KEY) || "[]"
    );
} catch (_) {
    adjustmentList = [];
}

if (!Array.isArray(skipList)) skipList = [];
if (!Array.isArray(adjustmentList)) adjustmentList = [];

const isSkipped = pen =>
    skipList.some(x =>
        String(x.pen) === String(pen) &&
        x.type !== "temporary_mobile_adjustment"
    );

function saveSkipList() {
    try {
        localStorage.setItem(
            SKIP_KEY,
            JSON.stringify(skipList)
        );
    } catch (e) {
        console.warn("Could not save GP skip list", e);
    }
}

function saveAdjustments() {
    try {
        localStorage.setItem(
            ADJUST_KEY,
            JSON.stringify(adjustmentList)
        );
    } catch (e) {
        console.warn("Could not save mobile adjustments", e);
    }
}

function exportSkipList() {
    const combined = [
        ...skipList,
        ...adjustmentList
    ];

    const blob = new Blob(
        [JSON.stringify(combined, null, 2)],
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
    "position:fixed;right:15px;top:130px;width:300px;" +
    "z-index:999999;background:#172b40;color:white;" +
    "padding:14px;border-radius:10px;font:13px Arial;" +
    "box-shadow:0 3px 15px #0008";

panel.innerHTML = `
<b style="font-size:16px">UDISE+ GP Auto-Fix v3</b>
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

function say(msg) {
    const d = document.createElement("div");
    d.textContent = msg;
    d.style.cssText =
        "padding:4px;border-bottom:1px solid #456";

    log.prepend(d);

    status.innerHTML =
        `Completed: ${S.done.length}<br>` +
        `Failed: ${S.failed.length}<br>` +
        `Temporary mobile adjustments: ${adjustmentList.length}<br>` +
        `Current PEN: ${S.current || "-"}<br>` +
        `Page start: ${S.targetStart || "-"}<br>` +
        `Status: ${S.phase}`;
}

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
    ) || [])].find(a =>
        a.innerText.trim() === "GP"
    );
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

    el.dispatchEvent(
        new Event("input", { bubbles: true })
    );

    el.dispatchEvent(
        new Event("change", { bubbles: true })
    );

    return true;
}

function addFailed(pen, reason) {
    if (!pen) return;

    const item = {
        pen: String(pen),
        name: S.name || "",
        reason: String(reason || "Failed")
    };

    if (!S.failed.some(x =>
        String(x.pen) === String(pen)
    )) {
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

function recordTemporaryMobile(
    pen,
    original,
    adjusted,
    retryStatus
) {
    const item = {
        type: "temporary_mobile_adjustment",
        pen: String(pen),
        name: S.name || "",
        reason: "ER1065 - Temporary mobile adjustment",
        originalMobile: original,
        adjustedMobile: adjusted,
        retryStatus: retryStatus,
        added: new Date().toISOString()
    };

    const index = adjustmentList.findIndex(x =>
        String(x.pen) === String(pen)
    );

    if (index >= 0) {
        adjustmentList[index] = item;
    } else {
        adjustmentList.push(item);
    }

    saveAdjustments();

    S.tempAdjustment = item;

    say(
        "Mobile adjustment logged: " +
        original + " → " + adjusted
    );

    return item;
}

function updateTemporaryStatus(pen, result) {
    const item = adjustmentList.find(x =>
        String(x.pen) === String(pen)
    );

    if (item) {
        item.retryStatus = result;
        item.verifiedAt = new Date().toISOString();
        saveAdjustments();
    }
}

function incrementLastDigit(value) {
    const v = String(value || "").trim();

    if (!/\d$/.test(v)) {
        throw Error(
            "Primary mobile number has no final digit"
        );
    }

    return v.replace(
        /\d$/,
        d => String((Number(d) + 1) % 10)
    );
}

function skipStudent(reason) {
    const pen = S.current;

    addFailed(pen, reason);
    say("SKIPPING " + pen + ": " + reason);

    S.phase = "returning";
    S.skipReason = reason;

    if (isGPPage()) {
        setTimeout(() => history.back(), 700);
    } else {
        S.current = "";
        S.name = "";
        S.phase = "idle";
    }
}

function hasER1065() {
    const t = document.body.innerText || "";

    return /\bER1065\b/i.test(t) ||
        /already registered with 5 students/i.test(t);
}

function dismissErrorMessage() {
    const close = document.querySelector(
        ".swal2-confirm, " +
        ".modal.show .btn-close, " +
        ".modal.show button[data-bs-dismiss='modal']"
    );

    if (close) {
        close.click();
        return true;
    }

    const buttons = [...document.querySelectorAll("button")];

    const ok = buttons.find(b =>
        /^(ok|close|confirm)$/i.test(
            (b.innerText || "").trim()
        )
    );

    if (ok) {
        ok.click();
        return true;
    }

    return false;
}

async function fixStudent() {
    if (S.busy || S.phase !== "opening") return;

    S.busy = true;
    S.phase = "editing";
    S.tempAdjustment = null;

    say("Editing: " + S.name);

    try {
        // 1. Clean address
        const address = document.getElementById("address");

        if (!address) {
            throw Error("Address field missing");
        }

        setValue(
            address,
            address.value.trim().replace(/\s+/g, " ")
        );

       
// 2. MOBILE NUMBER HANDLING

const mobile =
    document.querySelector(
        '#phoneNo, input[formcontrolname="phoneNo"]'
    );

const alt =
    document.querySelector(
        '#secondaryMobile, ' +
        '#alternateMobile, ' +
        '#alternateMobileNo, ' +
        'input[formcontrolname="secondaryMobile"], ' +
        'input[formcontrolname="alternateMobile"], ' +
        'input[name="secondaryMobile"], ' +
        'input[name="alternateMobile"], ' +
        'input[id*="alternate" i], ' +
        'input[name*="alternate" i]'
    );

function forceClear(el) {
    if (!el) return false;

    // Use native input value setter
    const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
    )?.set;

    if (setter) setter.call(el, "");
    else el.value = "";

    el.dispatchEvent(
        new Event("input", { bubbles: true })
    );

    el.dispatchEvent(
        new Event("change", { bubbles: true })
    );

    el.dispatchEvent(
        new Event("blur", { bubbles: true })
    );

    el.blur();

    return el.value.trim() === "";
}

if (mobile && alt) {
    const primary = mobile.value.trim();
    const alternate = alt.value.trim();

    if (!primary && alternate) {
        // Primary missing: copy alternate to primary
        setValue(mobile, alternate);

        say("Alternate copied to primary");

        // Clear alternate
        forceClear(alt);

        if (alt.value.trim() !== "") {
            await wait(300);
            forceClear(alt);
        }

        say(
            alt.value.trim() === ""
                ? "Alternate cleared successfully"
                : "WARNING: Alternate could not be cleared"
        );

    } else if (
        primary &&
        alternate &&
        primary === alternate
    ) {
        // Both numbers same: clear alternate
        forceClear(alt);

        if (alt.value.trim() !== "") {
            await wait(300);
            forceClear(alt);
        }

        say(
            alt.value.trim() === ""
                ? "Duplicate alternate cleared"
                : "WARNING: Duplicate alternate could not be cleared"
        );

    } else if (primary && alternate) {
        // Different numbers: leave both unchanged
        say("Both different numbers retained");

    } else {
        say("No mobile number changes required");
    }

} else {
    say(
        "Mobile field not found. Primary: " +
        !!mobile + ", Alternate: " + !!alt
    );
}


        // 3. Clear email field
        const emailFields = document.querySelectorAll(
            'input[type="email"],' +
            'input[id*="email" i],' +
            'input[name*="email" i],' +
            'input[formcontrolname*="email" i],' +
            'textarea[id*="email" i],' +
            'textarea[name*="email" i],' +
            'textarea[formcontrolname*="email" i]'
        );

        emailFields.forEach(el => setValue(el, ""));

        say("Email field cleared");

        // 4. Select Bengali
        const mother = document.getElementById("motherTongue");

        const container = mother?.querySelector(
            ".ng-select-container"
        );

        if (!container) {
            throw Error("Mother Tongue dropdown missing");
        }

        container.dispatchEvent(new MouseEvent(
            "mousedown",
            { bubbles: true, cancelable: true }
        ));

        container.dispatchEvent(new MouseEvent(
            "click",
            { bubbles: true, cancelable: true }
        ));

        let option = null;

        for (let i = 0; i < 40 && !option; i++) {
            await wait(250);

            option = [...document.querySelectorAll(
                ".ng-dropdown-panel .ng-option"
            )].find(o =>
                (o.innerText || o.textContent || "")
                    .toLowerCase().includes("3-bengali")
            );
        }

        if (!option) {
            throw Error("3-Bengali option missing");
        }

        option.click();
        await wait(400);

        // 5. Select Investigation blood group
        const blood =
            document.getElementById("bloodGroup") ||
            document.querySelector(
                'select[formcontrolname="bloodGroup"]'
            );

        if (!blood) {
            throw Error("Blood Group field missing");
        }

        const index = [...blood.options].findIndex(o =>
            o.text.toLowerCase().includes("investigation")
        );

        if (index < 0) {
            throw Error("Investigation option missing");
        }

        blood.selectedIndex = index;

        blood.dispatchEvent(
            new Event("change", { bubbles: true })
        );

        await wait(500);

        // 6. Submit
        const submit =
            document.querySelector('button[type="submit"]') ||
            [...document.querySelectorAll("button")].find(b =>
                /save|update/i.test(b.innerText)
            );

        if (!submit) {
            throw Error("Submit button missing");
        }

        S.phase = "saving";
        say("Saving: " + S.current);

        submit.click();

        // 7. First save response check
        let duplicateError = false;

        for (let i = 0; i < 24; i++) {
            await wait(250);

            if (hasER1065()) {
                duplicateError = true;
                break;
            }
        }

        // 8. ER1065: adjust primary number and retry once
        if (duplicateError) {
            say("ER1065 detected");

            const mobileNow =
                document.getElementById("phoneNo");

            if (!mobileNow || !mobileNow.value.trim()) {
                skipStudent(
                    "ER1065: Primary mobile number missing"
                );
                return;
            }

            const original = mobileNow.value.trim();

            let adjusted;

            try {
                adjusted = incrementLastDigit(original);
            } catch (e) {
                skipStudent(
                    "ER1065: " + e.message
                );
                return;
            }

            // Dismiss the error dialog if present
            dismissErrorMessage();
            await wait(700);

            // Wait for the old error message to disappear
            for (let i = 0; i < 12 && hasER1065(); i++) {
                await wait(250);
            }

            if (hasER1065()) {
                skipStudent(
                    "ER1065 message did not clear; retry not attempted"
                );
                return;
            }

            // Change only the final digit of primary mobile
            setValue(mobileNow, adjusted);

            say(
                "Retrying once: " +
                original + " → " + adjusted
            );

            // Find submit button again
            const retryButton =
                document.querySelector('button[type="submit"]') ||
                [...document.querySelectorAll("button")].find(b =>
                    /save|update/i.test(b.innerText)
                );

            if (!retryButton) {
                recordTemporaryMobile(
                    S.current,
                    original,
                    adjusted,
                    "Retry button missing"
                );

                skipStudent(
                    "ER1065: Retry button missing"
                );
                return;
            }

            retryButton.click();

            // Check retry response
            let retryError = false;

            for (let i = 0; i < 24; i++) {
                await wait(250);

                if (hasER1065()) {
                    retryError = true;
                    break;
                }
            }

            recordTemporaryMobile(
                S.current,
                original,
                adjusted,
                retryError
                    ? "ER1065 still present after retry"
                    : "Retry submitted; awaiting GP verification"
            );

            if (retryError) {
                dismissErrorMessage();

                skipStudent(
                    "ER1065 still present after one retry"
                );
                return;
            }

            say("Retry submitted; checking saved status");
        }

        // 9. Normal success/modal behaviour
        if (isGPPage()) {
            const close = document.querySelector(
                ".modal.show .btn-close, " +
                ".modal.show button[data-bs-dismiss='modal'], " +
                ".swal2-confirm"
            );

            if (close) {
                close.click();
                await wait(500);
            }
        }

        if (isGPPage()) {
            S.phase = "returning";
            history.back();
        }

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

            say(
                "REMINDER: Correct temporary mobile for PEN " +
                S.current
            );
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
    if (S.paused || S.stopped || S.busy) return;

    if (isGPPage()) {
        if (S.phase === "opening") {
            await fixStudent();
        }
        return;
    }

    if (!document.querySelector("mat-paginator")) return;

    // Ensure Section is All
    if (!S.sectionReady) {
        const section = document.querySelector(
            "select.form-select.w150"
        );

        if (section) {
            if (section.value !== "-1") {
                section.value = "-1";

                section.dispatchEvent(
                    new Event("input", { bubbles: true })
                );

                section.dispatchEvent(
                    new Event("change", { bubbles: true })
                );

                say(
                    "Section changed to All; waiting for list refresh..."
                );

                await wait(1600);
            }

            S.sectionReady = true;
            S.targetStart = rangeStart() || 1;
            S.phase = "idle";

            say("Section filter: All");
            return;

        } else {
            S.sectionReady = true;

            say(
                "Section dropdown not found; continuing with current list."
            );
        }
    }

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

        if (restored) {
            S.phase = "returning";
        }

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

    // Find only red/incomplete GP records
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
            S.failed.some(x =>
                String(x.pen) === String(pen)
            )
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

    // Re-check Section All before paging
    const section = document.querySelector(
        "select.form-select.w150"
    );

    if (section && section.value !== "-1") {
        section.value = "-1";

        section.dispatchEvent(
            new Event("input", { bubbles: true })
        );

        section.dispatchEvent(
            new Event("change", { bubbles: true })
        );

        say(
            "Section was not All. Changed to All; waiting..."
        );

        await wait(1600);

        S.targetStart = rangeStart() || 1;
        S.phase = "idle";
        return;
    }

    // No more red GP on this page
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

        say("ALL PAGES CHECKED");
        say("Completed: " + S.done.length);

        say(
            "Failed / permanently skipped: " +
            skipList.length
        );

        say(
            "Temporary mobile adjustments: " +
            adjustmentList.length
        );

        if (skipList.length || adjustmentList.length) {
            say("Downloading GP_Invalid_Students.json...");
            exportSkipList();
        }

        console.table(S.failed);
        console.table(adjustmentList);
    }
}

// Pause / Resume
panel.querySelector("#gpPause").onclick = () => {
    S.paused = !S.paused;

    panel.querySelector("#gpPause").innerText =
        S.paused ? "Resume" : "Pause";

    say(S.paused ? "Paused" : "Resumed");
};

// Export JSON
panel.querySelector("#gpExport").onclick =
    exportSkipList;

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

            // Restore temporary adjustment records separately
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

            // Restore permanent skip records
            if (!isSkipped(x.pen)) {
                skipList.push({
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
            "Loaded " + added +
            " skipped PENs and " +
            adjustments +
            " temporary adjustments."
        );

    } catch (err) {
        alert("Could not load skip list: " + err.message);
    }

    e.target.value = "";
};

// Stop
panel.querySelector("#gpStop").onclick = () => {
    S.stopped = true;
    S.phase = "stopped";

    clearInterval(timer);

    say("Stopped by user");
};

// Start automation
const timer = setInterval(() => {
    tick().catch(e => {
        console.error("GP Auto-Fix error:", e);
        skipStudent(e.message || String(e));
    });
}, 900);

S.failed = skipList.map(x => ({
    pen: String(x.pen),
    name: x.name || "",
    reason: x.reason || "Previously failed"
}));

say("Loaded permanent skip list: " + skipList.length + " students");
say("Loaded temporary adjustments: " + adjustmentList.length);
say("FULL AUTO STARTED");
say("Only red GP records not on the skip list will be processed.");

})();
