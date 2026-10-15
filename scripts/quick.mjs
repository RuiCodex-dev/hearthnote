import { buildServer } from "../server/main.js";
const { server } = await buildServer();
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
let cookie = "";
async function call(path, opts = {}) {
  const res = await fetch(base + path, { ...opts, headers: { "content-type": "application/json", cookie, ...(opts.headers || {}) } });
  const sc = res.headers.get("set-cookie"); if (sc) cookie = sc.split(";")[0];
  const t = await res.text(); try { return [res.status, JSON.parse(t)]; } catch { return [res.status, t]; }
}
let [s, st] = await call("/api/state");
console.log(s, st.notes.length, "notes", st.observations.length, "obs", st.memory.length, "facts", st.routines.length, "routines", st.tasks.length, "tasks", st.appointments.length, "appts", st.config.provider);
console.log(st.memory.map(f=>f.status+': '+f.fact));
console.log(st.routines.map(f=>f.status+': '+f.title+' '+f.time+' '+f.days));
console.log(st.appointments);
[s, st] = await call("/api/notes", { method: "POST", body: JSON.stringify({ text: "She fell in the bathroom and hit her head on the sink. Need to call the GP tomorrow.", authorId: "P2" }) });
console.log(s, st.state.notes[0].flags, st.state.tasks.slice(-1));
[s, st] = await call("/api/skills/weekly-digest/run", { method: "POST" });
console.log(s, JSON.stringify(st.state.briefs[0].brief, null, 1).slice(0, 1500));
[s, st] = await call("/api/ask", { method: "POST", body: JSON.stringify({ question: "When did the dizziness start?" }) });
console.log(s, st.answer);
const led = st.state.ledger[0];
[s, st] = await call("/api/ledger/" + led.id);
console.log(s, st.outbound.slice(0, 900));
console.log("leaks:", (st.outbound.match(/Mireille|Anouk|Bram|Sofie|Claes|Vaartstraat|016 23/g)||[]));
const cal = await fetch(base + (await call("/api/state"))[1].calendarPath).then(r=>r.text());
console.log(cal.slice(0, 600));
server.close();
