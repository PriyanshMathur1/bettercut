"""BetterCut Cloud: secrets, storage, guard, agent, memory and the multi-user API (no network, no real model)."""
import json
import time

import jwt
import pytest

from bettercut.cloud import agent, config, db, guard, jobs, memory, storage, vault

JWT_SECRET = "test-jwt-secret-that-is-long-enough-123"


def base_spec():
    return {
        "version": 1,
        "source": {"src": "@proj/assets/source.mp4", "width": 1080, "height": 1920, "duration": 10, "fps": 30},
        "segments": [{"start": 0.0, "end": 4.0}, {"start": 5.0, "end": 9.0}],
        "words": [{"text": "Hello", "start": 0.2, "end": 0.6}, {"text": "world.", "start": 0.7, "end": 1.2},
                  {"text": "Second", "start": 5.2, "end": 5.7}, {"text": "shot.", "start": 5.8, "end": 6.3}],
        "captions": {"enabled": True, "style": "bold-pop", "position": "lower", "scale": 1, "wordsPerPage": 3},
        "hook": {"text": "Hello world", "style": "slam", "duration": 2},
        "overlays": [], "broll": [],
        "audio": {"musicVolume": 0.2, "duck": True, "sfx": True, "sfxVolume": 0.5, "voiceVolume": 1},
        "brand": {"name": "Test", "handle": "test"},
    }


@pytest.fixture()
def cloud(tmp_path, monkeypatch):
    for k in ("DATABASE_URL", "BETTERCUT_SECRET", "SUPABASE_URL", "ALLOWED_EMAILS", "STORAGE", "AUTH_PROVIDERS", "RENDERS_PER_DAY"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("BETTERCUT_DATA", str(tmp_path))
    monkeypatch.setenv("AUTH_MODE", "supabase")
    monkeypatch.setenv("SUPABASE_JWT_SECRET", JWT_SECRET)
    db.reset(); vault.reset(); storage.reset()
    cfg = config.reset()
    yield cfg
    db.reset(); vault.reset(); storage.reset()


def token(uid, email="a@example.com", exp=3600, provider="google"):
    claims = {"sub": uid, "email": email, "aud": "authenticated", "exp": int(time.time()) + exp,
              "app_metadata": {"provider": provider, "providers": [provider]}}
    return {"Authorization": "Bearer " + jwt.encode(claims, JWT_SECRET, algorithm="HS256")}


@pytest.fixture()
def client(cloud):
    from fastapi.testclient import TestClient
    from bettercut.cloud.app import app

    return TestClient(app)  # no lifespan: workers stay off, jobs run with jobs.run_pending()


def seed_project(uid, spec=None, title="My reel"):
    with db.session() as s:
        if s.get(db.User, uid) is None:
            s.add(db.User(id=uid, email=f"{uid}@example.com"))
            s.flush()
        p = db.Project(user_id=uid, title=title, status="ready")
        s.add(p)
        s.flush()
        pid = p.id
    jobs.add_version(pid, spec or base_spec(), "pipeline", "First cut")
    return pid


# ---- vault ---------------------------------------------------------------------------

def test_model_keys_are_encrypted_and_bound_to_their_user(cloud):
    enc = vault.encrypt("sk-secret-123", "user-a")
    assert "sk-secret-123" not in enc
    assert vault.decrypt(enc, "user-a") == "sk-secret-123"
    with pytest.raises(Exception):
        vault.decrypt(enc, "user-b")


def test_media_links_expire_and_cannot_be_moved(cloud):
    q = dict(p.split("=") for p in vault.sign("u1/p1/assets/source.mp4", ttl=60).split("&"))
    assert vault.verify("u1/p1/assets/source.mp4", q["exp"], q["sig"])
    assert not vault.verify("u2/p9/assets/source.mp4", q["exp"], q["sig"])
    old = dict(p.split("=") for p in vault.sign("k", ttl=-5).split("&"))
    assert not vault.verify("k", old["exp"], old["sig"])


# ---- storage -------------------------------------------------------------------------

def test_spec_paths_round_trip_through_tokens(tmp_path):
    proj = tmp_path / "u" / "p"
    spec = {"source": {"src": str(proj / "assets/source.mp4")}, "audio": {"music": str(proj / "assets/user/song.mp3")},
            "hook": {"text": "/not a path"}, "broll": [{"src": "https://videos.pexels.com/x.mp4"}]}
    rel = storage.relativise(spec, proj)
    assert rel["source"]["src"] == "@proj/assets/source.mp4" and rel["broll"][0]["src"].startswith("https://")
    assert storage.referenced(rel) == ["assets/source.mp4", "assets/user/song.mp3"]
    assert storage.absolutise(rel, proj) == spec


def test_s3_storage_syncs_outputs_and_fetches_them_back(cloud, tmp_path):
    boto3 = pytest.importorskip("boto3")
    from moto import mock_aws

    with mock_aws():
        s3 = boto3.client("s3", region_name="us-east-1", aws_access_key_id="x", aws_secret_access_key="y")
        s3.create_bucket(Bucket="reels")
        storage.reset(storage.S3Storage("reels", None, "x", "y", client=s3))
        proj = storage.project_dir("u1", "p1")
        (proj / "assets").mkdir(parents=True)
        (proj / "assets" / "source.mp4").write_bytes(b"video-bytes")
        (proj / "inputs").mkdir()
        (proj / "inputs" / "raw.mp4").write_bytes(b"raw")
        assert storage.sync_up("u1", "p1") == 1  # inputs are not kept
        (proj / "assets" / "source.mp4").unlink()
        assert storage.sync_down("u1", "p1", ["assets/source.mp4", "assets/gone.mp4"]) == ["assets/gone.mp4"]
        assert (proj / "assets" / "source.mp4").read_bytes() == b"video-bytes"
        assert storage.store().url("u1/p1/assets/source.mp4").startswith("http")
        assert storage.store().size("u1/") == len(b"video-bytes")
        storage.store().delete_prefix("u1/p1/")
        assert not storage.store().exists("u1/p1/assets/source.mp4")


# ---- guard ---------------------------------------------------------------------------

@pytest.mark.parametrize("value,ok", [
    ("@proj/assets/user/song.mp3", True), ("https://videos.pexels.com/a.mp4", True), ("whoosh", True), ("", True),
    ("/etc/passwd", False), ("@proj/../../other/secret.mp4", False), ("file:///etc/passwd", False),
    ("http://169.254.169.254/latest/meta-data", False), ("https://evil.example.com/a.mp4", False), ("~/.ssh/id_rsa", False),
])
def test_specs_can_only_point_at_project_files(value, ok):
    issues = guard.spec_issues({"audio": {"music": value}, "hook": {"text": "/etc/passwd is fine as text"}})
    assert (issues == []) == ok


def test_model_urls_must_be_public_https():
    assert guard.public_url_issue("http://localhost:11434/v1") is not None
    assert guard.public_url_issue("https://127.0.0.1/v1") is not None
    assert guard.public_url_issue("ftp://x") is not None
    assert guard.public_url_issue("http://localhost:11434/v1", allow_private=True) is None


# ---- agent ---------------------------------------------------------------------------

def scripted(*turns):
    """A fake model: each turn is a list of (tool, args) or a plain string."""
    it = iter(turns)
    seen = []

    def complete(messages, tools):
        seen.append(messages)
        t = next(it)
        if isinstance(t, str):
            return {"content": t, "tool_calls": [], "tokens_in": 10, "tokens_out": 5}
        return {"content": "", "tool_calls": [{"id": f"c{i}", "name": n, "arguments": json.dumps(a)} for i, (n, a) in enumerate(t)],
                "tokens_in": 10, "tokens_out": 5}

    complete.seen = seen
    return complete


def test_agent_applies_a_note_through_a_validated_patch():
    c = scripted([("get_spec", {"section": "captions"})],
                 [("patch_spec", {"ops": [{"op": "replace", "path": "/captions/scale", "value": 1.2}], "why": "bigger captions"})],
                 [("done", {"summary": "Captions are 20% bigger."})])
    res = agent.run(base_spec(), [{"at": 1.0, "text": "make captions bigger"}], c, log=lambda m: None)
    assert res["changed"] and res["spec"]["captions"]["scale"] == 1.2
    assert res["summary"] == "Captions are 20% bigger." and res["tokens_in"] == 30
    assert "at 1.0s of the preview" in c.seen[0][1]["content"]


def test_agent_cannot_break_the_spec_or_touch_the_source():
    c = scripted([("patch_spec", {"ops": [{"op": "replace", "path": "/source/src", "value": "/etc/passwd"}], "why": "x"}),
                  ("patch_spec", {"ops": [{"op": "replace", "path": "/nope/deeper", "value": 1}], "why": "x"}),
                  ("patch_spec", {"ops": [{"op": "replace", "path": "/segments", "value": []}], "why": "x"}),
                  ("patch_spec", {"ops": [{"op": "add", "path": "/audio/music", "value": "/etc/passwd"}], "why": "x"})],
                 [("done", {"summary": "Couldn't do it."})])
    res = agent.run(base_spec(), [{"text": "break it"}], c, log=lambda m: None, check=guard.spec_issues)
    assert not res["changed"] and res["spec"] == base_spec()
    assert all(s["result"].startswith("error") for s in res["steps"][:4])


def test_agent_tools_map_preview_time_to_source_time_and_find_words():
    ses = agent.Session(base_spec(), lambda k, t, v: None)
    assert json.loads(ses.call("time_map", {"output_seconds": 5.0})) == {"source": 6.0, "segment": 1}  # 4 s of shot 1, then 1 s in
    hit = json.loads(ses.call("find_words", {"text": "second shot"}))[0]
    assert (hit["first"], hit["last"], hit["out"]) == (2, 3, 4.2)
    assert [w["i"] for w in json.loads(ses.call("get_spec", {"section": "words", "from_output": 4.0}))] == [2, 3]
    assert "bold-pop" in json.loads(ses.call("list_options", {"kind": "captionStyles"}))
    assert ses.call("nope", {}).startswith("error")


def test_agent_stops_at_the_step_limit_and_keeps_changes():
    looping = scripted(*[[("patch_spec", {"ops": [{"op": "replace", "path": "/captions/scale", "value": 1 + i / 10}], "why": f"step {i}"})] for i in range(1, 6)])
    res = agent.run(base_spec(), [{"text": "bigger"}], looping, max_steps=3, log=lambda m: None)
    assert res["spec"]["captions"]["scale"] == 1.3 and "step limit" in res["summary"]


def test_connection_test_requires_tool_calling():
    good = scripted([("set_caption_scale", {"scale": 1.2})])
    assert agent.test_connection(good)["ok"]
    assert not agent.test_connection(scripted("Sure! I made them bigger."))["ok"]

    def broken(messages, tools):
        raise RuntimeError("401 invalid key sk-abcdef1234567890")

    r = agent.test_connection(broken)
    assert not r["ok"] and "sk-abcdef" not in r["error"]


# ---- memory --------------------------------------------------------------------------

def test_memory_feeds_spellings_preferences_and_the_prompt(cloud):
    with db.session() as s:
        s.add(db.User(id="u1"))
        s.flush()
        s.add_all([db.Memory(user_id="u1", kind="spelling", text="Diners Club, SmartBuy"),
                   db.Memory(user_id="u1", kind="preference", text="Bigger captions", value={"captions": {"scale": 1.15}}),
                   db.Memory(user_id="u1", kind="style", text="Hooks are questions"),
                   db.Memory(user_id="u1", kind="style", text="Not approved yet", status="proposed")])
    mems = memory.active("u1")
    assert memory.spellings(mems) == ["Diners Club", "SmartBuy"]
    out = memory.apply_preferences(base_spec(), mems)
    assert out["captions"]["scale"] == 1.15 and out["captions"]["style"] == "bold-pop"
    block = memory.prompt_block(mems)
    assert "Hooks are questions" in block and "Not approved yet" not in block
    assert memory.propose("u1", "style", "No emoji") and memory.propose("u1", "style", "No emoji") is None


# ---- API -----------------------------------------------------------------------------

def test_api_requires_sign_in_and_rejects_bad_tokens(client):
    assert client.get("/api/projects").status_code == 401
    assert client.get("/api/projects", headers={"Authorization": "Bearer nonsense"}).status_code == 401
    assert client.get("/api/projects", headers=token("u1", exp=-10)).status_code == 401
    assert client.get("/api/projects", headers=token("u1")).json() == []
    assert client.get("/api/config").json()["auth"] == "supabase"


def test_only_google_sign_in_is_accepted(client):
    assert client.get("/api/projects", headers=token("u1", provider="email")).status_code == 403
    assert client.get("/api/projects", headers=token("u1", provider="google")).status_code == 200
    assert client.get("/api/config").json()["providers_auth"] == ["google"]


def test_invite_list_limits_who_can_sign_in(client, monkeypatch):
    monkeypatch.setenv("ALLOWED_EMAILS", "friend@example.com")
    config.reset()
    assert client.get("/api/projects", headers=token("u1", "stranger@example.com")).status_code == 403
    assert client.get("/api/projects", headers=token("u2", "Friend@Example.com")).status_code == 200


def test_users_cannot_see_or_change_each_others_reels(client):
    client.get("/api/me", headers=token("alice"))
    client.get("/api/me", headers=token("bob"))
    pid = seed_project("alice")
    assert client.get(f"/api/projects/{pid}/spec", headers=token("alice")).status_code == 200
    for method, url in [("get", f"/api/projects/{pid}/spec"), ("post", f"/api/projects/{pid}/undo"), ("delete", f"/api/projects/{pid}"),
                        ("post", f"/api/projects/{pid}/render"), ("get", f"/api/projects/{pid}/history")]:
        assert getattr(client, method)(url, headers=token("bob")).status_code == 404
    assert client.put(f"/api/projects/{pid}/spec", headers=token("bob"), json=base_spec()).status_code == 404
    assert [p["id"] for p in client.get("/api/projects", headers=token("bob")).json()] == []


def test_spec_save_versions_undo_and_guard(client):
    pid = seed_project("alice")
    h = token("alice")
    got = client.get(f"/api/projects/{pid}/spec", headers=h).json()
    assert got["media"]["@proj/assets/source.mp4"].startswith("/api/media/alice/")
    spec = got["spec"]
    spec["captions"]["scale"] = 1.3
    assert client.put(f"/api/projects/{pid}/spec", headers=h, json=spec).status_code == 200
    spec["captions"]["scale"] = 1.4  # autosave a moment later: same version
    v2 = client.put(f"/api/projects/{pid}/spec", headers=h, json=spec).json()["version"]
    assert len(client.get(f"/api/projects/{pid}/history", headers=h).json()) == 2
    bad = json.loads(json.dumps(spec)); bad["audio"]["music"] = "/etc/passwd"
    assert client.put(f"/api/projects/{pid}/spec", headers=h, json=bad).status_code == 400
    moved = json.loads(json.dumps(spec)); moved["source"]["src"] = "@proj/assets/other.mp4"
    assert client.put(f"/api/projects/{pid}/spec", headers=h, json=moved).status_code == 400
    undone = client.post(f"/api/projects/{pid}/undo", headers=h).json()
    assert undone["spec"]["captions"]["scale"] == 1 and undone["version"] < v2
    assert client.post(f"/api/projects/{pid}/undo", headers=h).status_code == 409


def test_signed_media_is_served_with_ranges(client):
    pid = seed_project("alice")
    f = storage.project_dir("alice", pid) / "assets" / "source.mp4"
    f.parent.mkdir(parents=True)
    f.write_bytes(bytes(range(256)) * 4)
    url = client.get(f"/api/projects/{pid}/spec", headers=token("alice")).json()["media"]["@proj/assets/source.mp4"]
    r = client.get(url, headers={"Range": "bytes=10-19"})  # no auth header: the link itself is the permission
    assert r.status_code == 206 and r.content == bytes(range(10, 20)) and r.headers["content-range"] == "bytes 10-19/1024"
    assert client.get(url.replace("sig=", "sig=x")).status_code == 403


def test_notes_run_on_the_users_model_and_become_an_undoable_version(client):
    pid = seed_project("alice")
    h = token("alice")
    assert client.post(f"/api/projects/{pid}/notes", headers=h, json={"notes": [{"t": 1, "text": "bigger"}]}).status_code == 400  # no model yet
    with db.session() as s:
        s.add(db.ModelConnection(user_id="alice", provider="anthropic", model="claude-test", key_enc=vault.encrypt("sk-test-12345678", "alice"),
                                 key_last4="5678", caps={"ok": True, "tools": True}, is_default=True))
    listed = client.get("/api/models", headers=h).json()
    assert listed[0]["keyLast4"] == "5678" and "sk-test" not in json.dumps(listed)
    jid = client.post(f"/api/projects/{pid}/notes", headers=h, json={"notes": [{"t": 1, "text": "bigger captions, always"}]}).json()["job"]
    fake = scripted([("patch_spec", {"ops": [{"op": "replace", "path": "/captions/scale", "value": 1.2}], "why": "bigger"}),
                     ("remember", {"kind": "preference", "text": "Captions 20% bigger", "value": {"captions": {"scale": 1.2}}})],
                    [("done", {"summary": "Made the captions 20% bigger."})])
    job = jobs.claim()
    ctx = jobs.Ctx(job)
    result = jobs.h_notes(ctx, complete=fake)
    assert result["changed"] and result["proposals"] == ["Captions 20% bigger"]
    got = client.get(f"/api/projects/{pid}/spec", headers=h).json()
    assert got["spec"]["captions"]["scale"] == 1.2 and got["author"] == "agent"
    mem = client.get("/api/memory", headers=h).json()
    assert mem[0]["status"] == "proposed" and mem[0]["source"] == "agent"
    assert client.patch(f"/api/memory/{mem[0]['id']}", headers=h, json={"status": "active"}).json()["status"] == "active"
    assert client.post(f"/api/projects/{pid}/undo", headers=h).json()["spec"]["captions"]["scale"] == 1
    assert client.get(f"/api/projects/{pid}/notes", headers=h).json()[0]["reply"] == "Made the captions 20% bigger."
    assert client.get(f"/api/jobs/{jid}", headers=token("bob")).status_code == 404


def test_brand_and_memory_are_per_user(client):
    a, b = token("alice"), token("bob")
    client.put("/api/brand", headers=a, json={"name": "Alice", "handle": "alice", "evil": "x"})
    assert client.get("/api/brand", headers=a).json()["handle"] == "alice"
    assert client.get("/api/brand", headers=b).json()["handle"] == "yourhandle"
    mid = client.post("/api/memory", headers=a, json={"kind": "spelling", "text": "Diners Club"}).json()["id"]
    assert client.get("/api/memory", headers=b).json() == []
    assert client.delete(f"/api/memory/{mid}", headers=b).status_code == 404
    assert client.post("/api/memory", headers=a, json={"kind": "preference", "text": "x", "value": {"audio": {"music": "/etc/passwd"}}}).status_code == 400


def test_deleting_a_reel_removes_its_files_and_rows(client):
    pid = seed_project("alice")
    f = storage.project_dir("alice", pid) / "assets" / "source.mp4"
    f.parent.mkdir(parents=True)
    f.write_bytes(b"x")
    assert client.delete(f"/api/projects/{pid}", headers=token("alice")).status_code == 200
    assert not f.exists()
    with db.session() as s:
        assert s.get(db.Project, pid) is None and db.latest_spec(s, pid) is None


def test_render_limit_and_job_queue_position(client, monkeypatch):
    monkeypatch.setenv("RENDERS_PER_DAY", "1")
    config.reset()
    p1, p2 = seed_project("alice"), seed_project("alice")
    h = token("alice")
    j1 = client.post(f"/api/projects/{p1}/render", headers=h, json={"quality": "draft", "aspects": ["9x16", "bogus"]}).json()["job"]
    assert client.post(f"/api/projects/{p1}/render", headers=h, json={}).status_code == 429
    assert client.post(f"/api/projects/{p2}/render", headers=h, json={"quality": "nope"}).status_code == 400
    j = client.get(f"/api/jobs/{j1}", headers=h).json()
    assert j["queued"] and j["position"] == 1 and j["status"] == "running"
    with db.session() as s:
        assert s.get(db.Job, j1).params == {"quality": "draft", "aspects": ["9x16"]}


# ---- the real LiteLLM path, against a fake OpenAI-compatible server -----------------

@pytest.fixture()
def fake_openai():
    import threading
    from http.server import BaseHTTPRequestHandler, HTTPServer

    script: list = []
    seen: list = []

    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["content-length"])))
            seen.append({"auth": self.headers.get("authorization"), "body": body})
            turn = script.pop(0)
            msg = {"role": "assistant", "content": turn if isinstance(turn, str) else None}
            if not isinstance(turn, str):
                msg["tool_calls"] = [{"id": f"call_{i}", "type": "function", "function": {"name": n, "arguments": json.dumps(a)}} for i, (n, a) in enumerate(turn)]
            out = json.dumps({"id": "x", "object": "chat.completion", "created": 0, "model": body["model"],
                              "choices": [{"index": 0, "message": msg, "finish_reason": "tool_calls" if "tool_calls" in msg else "stop"}],
                              "usage": {"prompt_tokens": 100, "completion_tokens": 20, "total_tokens": 120}}).encode()
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(out)))
            self.end_headers()
            self.wfile.write(out)

    srv = HTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield {"base": f"http://127.0.0.1:{srv.server_port}/v1", "script": script, "seen": seen}
    srv.shutdown()


def test_connecting_a_model_and_editing_through_litellm(client, fake_openai, monkeypatch):
    monkeypatch.setenv("AUTH_MODE", "dev")  # private model URLs are only allowed when self-hosting
    config.reset()
    pid = seed_project("dev")
    body = {"provider": "openai_compatible", "model": "test-model", "apiKey": "sk-user-key-12345678", "apiBase": fake_openai["base"]}

    fake_openai["script"].append("I can't use tools.")
    r = client.post("/api/models", json=body)
    assert r.status_code == 400 and "tool" in r.json()["detail"]

    fake_openai["script"].append([("set_caption_scale", {"scale": 1.2})])
    conn = client.post("/api/models", json=body).json()
    assert conn["caps"]["tools"] and conn["isDefault"] and conn["keyLast4"] == "5678"
    assert fake_openai["seen"][-1]["auth"] == "Bearer sk-user-key-12345678"
    with db.session() as s:
        assert "sk-user-key" not in s.get(db.ModelConnection, conn["id"]).key_enc

    fake_openai["script"] += [[("patch_spec", {"ops": [{"op": "replace", "path": "/hook/text", "value": "Is your morning broken?"}], "why": "hook as a question"})],
                              [("done", {"summary": "Rewrote the hook as a question."})]]
    client.post(f"/api/projects/{pid}/notes", json={"notes": [{"text": "make the hook a question"}]})
    assert jobs.run_pending() == 1
    got = client.get(f"/api/projects/{pid}/spec").json()
    assert got["spec"]["hook"]["text"] == "Is your morning broken?" and got["summary"] == "Rewrote the hook as a question."
    sent = fake_openai["seen"][-2]["body"]
    assert {t["function"]["name"] for t in sent["tools"]} >= {"patch_spec", "get_spec", "done"}
    assert "make the hook a question" in sent["messages"][1]["content"]
    with db.session() as s:
        run = s.query(db.AgentRun).one()
        assert (run.tokens_in, run.tokens_out, run.model) == (200, 40, "test-model")


# ---- connector (MCP) -------------------------------------------------------------------

def rpc(client, url, method, params=None, mid=1, headers=None):
    return client.post(url, json={"jsonrpc": "2.0", "id": mid, "method": method, "params": params or {}}, headers=headers or {})


def tool(client, url, name, args=None):
    r = rpc(client, url, "tools/call", {"name": name, "arguments": args or {}}).json()["result"]
    return r["content"][0]["text"], r["isError"]


def make_link(client, uid):
    r = client.post("/api/connector", headers=token(uid))
    assert r.status_code == 200 and r.json()["on"]
    return "/mcp/" + r.json()["url"].rsplit("/mcp/", 1)[1]


def test_connector_link_handshake_and_tool_list(client):
    seed_project("u1")
    url = make_link(client, "u1")
    init = rpc(client, url, "initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "t", "version": "1"}}).json()["result"]
    assert init["protocolVersion"] == "2025-06-18" and "tools" in init["capabilities"] and init["serverInfo"]["name"] == "bettercut"
    assert client.post(url, json={"jsonrpc": "2.0", "method": "notifications/initialized"}).status_code == 202
    names = {t["name"] for t in rpc(client, url, "tools/list").json()["result"]["tools"]}
    assert {"list_reels", "get_guide", "get_spec", "find_words", "patch_spec", "undo", "render", "job_status"} <= names
    assert "done" not in names
    assert rpc(client, url, "nope").json()["error"]["code"] == -32601
    assert client.get(url).status_code == 405
    # the link shown again later is the same one
    assert client.get("/api/connector", headers=token("u1")).json()["url"].endswith(url)


def test_connector_edits_show_up_in_the_editor_and_undo(client):
    pid = seed_project("u1")
    url = make_link(client, "u1")
    reels = json.loads(tool(client, url, "list_reels")[0])
    assert reels["reels"][0]["id"] == pid and reels["reels"][0]["editor"].endswith("/?reel=" + pid)
    before = client.get(f"/api/projects/{pid}/head", headers=token("u1")).json()

    hits, bad = tool(client, url, "find_words", {"reel": pid, "text": "second shot"})
    assert not bad and json.loads(hits)[0]["first"] == 2
    out, bad = tool(client, url, "patch_spec", {"reel": pid, "ops": [{"op": "replace", "path": "/captions/scale", "value": 1.3}], "why": "Bigger captions"})
    assert not bad and out.startswith("ok")

    head = client.get(f"/api/projects/{pid}/head", headers=token("u1")).json()
    assert head["version"] != before["version"] and head["author"] == "agent" and head["summary"] == "Bigger captions"
    assert client.get(f"/api/projects/{pid}/spec", headers=token("u1")).json()["spec"]["captions"]["scale"] == 1.3

    assert tool(client, url, "undo", {"reel": pid})[0].startswith("ok")
    assert client.get(f"/api/projects/{pid}/spec", headers=token("u1")).json()["spec"]["captions"]["scale"] == 1
    # never undoes the creator's own work
    assert tool(client, url, "undo", {"reel": pid})[1] is True


def test_connector_rejects_bad_patches_and_other_peoples_reels(client):
    mine, theirs = seed_project("u1"), seed_project("u2")
    url = make_link(client, "u1")
    out, bad = tool(client, url, "patch_spec", {"reel": mine, "ops": [{"op": "replace", "path": "/source/src", "value": "/etc/passwd"}], "why": "x"})
    assert bad and "can't be changed" in out
    out, bad = tool(client, url, "patch_spec", {"reel": mine, "ops": [{"op": "add", "path": "/audio/music", "value": "/etc/passwd"}], "why": "x"})
    assert bad
    for name, args in (("get_spec", {"reel": theirs, "section": "overview"}), ("patch_spec", {"reel": theirs, "ops": [{"op": "replace", "path": "/captions/scale", "value": 2}], "why": "x"}),
                       ("render", {"reel": theirs}), ("undo", {"reel": theirs})):
        out, bad = tool(client, url, name, args)
        assert bad and "no such reel" in out
    assert theirs not in tool(client, url, "list_reels")[0]


def test_connector_link_can_be_replaced_and_turned_off(client):
    seed_project("u1")
    old = make_link(client, "u1")
    new = make_link(client, "u1")
    assert old != new
    assert rpc(client, old, "ping").status_code == 401
    assert rpc(client, new, "ping").json()["result"] == {}
    assert client.delete("/api/connector", headers=token("u1")).status_code == 200
    assert rpc(client, new, "ping").status_code == 401
    assert client.get("/api/connector", headers=token("u1")).json()["on"] is False
    # without a link there is no way in on a hosted site
    assert rpc(client, "/mcp", "ping").status_code == 401
    assert rpc(client, "/mcp/not-a-real-token-0000000000", "ping").status_code == 401


def test_connector_render_is_queued_with_the_daily_limit_and_remember_only_proposes(client, monkeypatch):
    pid = seed_project("u1")
    url = make_link(client, "u1")
    job = json.loads(tool(client, url, "render", {"reel": pid, "quality": "draft", "aspects": ["9x16", "bogus"]})[0])["job"]
    with db.session() as s:
        j = s.get(db.Job, job)
        assert j.kind == "render" and j.params == {"quality": "draft", "aspects": ["9x16"]}
    assert json.loads(tool(client, url, "job_status", {"job": job})[0])["status"] == "queued"
    assert tool(client, url, "render", {"reel": pid, "quality": "master"})[1] is True
    monkeypatch.setenv("RENDERS_PER_DAY", "1")
    config.reset()
    assert "used up" in tool(client, url, "render", {"reel": pid})[0]

    assert "suggested" in tool(client, url, "remember", {"kind": "style", "text": "Hooks are questions"})[0]
    with db.session() as s:
        from sqlalchemy import select
        m = s.scalars(select(db.Memory).where(db.Memory.user_id == "u1")).one()
        assert m.status == "proposed" and m.source == "agent"


def test_local_mode_has_a_keyless_endpoint_that_web_pages_cannot_drive(client, monkeypatch):
    monkeypatch.setenv("AUTH_MODE", "dev")
    config.reset()
    assert rpc(client, "/mcp", "ping").json()["result"] == {}
    assert rpc(client, "/mcp", "ping", headers={"Origin": "https://evil.example"}).status_code == 403
