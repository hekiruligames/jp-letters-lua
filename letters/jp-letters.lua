-- SPDX-License-Identifier: GPL-2.0-or-later
-- Japanese letters / Marshmallow-reading source, version 0.4.1.
local obs = obslua
local bit = require("bit")
local ROOT = script_path()
local Http = dofile(ROOT .. "runtime/http.lua")
local Fonts = dofile(ROOT .. "runtime/fonts.lua")
local Webfonts = dofile(ROOT .. "runtime/webfonts.lua")
local ffi = require("ffi")
local font_families, font_error
local records, server, server_error, save_at = {}, nil, nil, nil
local retired_hotkeys = {}
local revision_counter = 0
local JSON = "application/json; charset=utf-8"
local default_font = package.config:sub(1, 1) == "\\" and "Yu Gothic" or "YuGothic"
if require("ffi").os == "Linux" then default_font = "Noto Sans CJK JP" end
local DEFAULT = [[{"version":1,"items":[],"selectedId":null,"draft":{"id":null,"title":"","text":""},"style":{"width":960,"height":540,"font":"FONT","fontSize":48,"lineHeight":1.5,"padding":{"top":40,"right":40,"bottom":40,"left":40},"innerPadding":24,"textColor":"#222222","outlineColor":"#101827","outlineWidth":0,"background":"#ffffff","backgroundOpacity":1,"radius":24,"align":"left","verticalAlign":"center","showTitle":false,"showPageNumber":true,"readingMode":"pages","autoHeight":false},"live":{"visible":false,"id":null,"title":"","text":"","page":0,"style":null,"scroll":0},"ui":{"preset":"blue","custom":{"background":"#f3f6fa","panel":"#ffffff","accent":"#3468d4","text":"#263349"}}}]]
DEFAULT = DEFAULT:gsub("FONT", default_font)

local function release(value) if value then obs.obs_data_release(value) end end
local function next_revision() revision_counter = revision_counter + 1 return revision_counter end
local function clock() return tonumber(obs.os_gettime_ns()) / 1000000000 end
local function int(value, low, high) return math.max(low, math.min(high, math.floor(value))) end

local function state_data(text)
    local state = text and obs.obs_data_create_from_json(text) or nil
    if not state or obs.obs_data_get_int(state, "version") ~= 1 then
        release(state)
        state = obs.obs_data_create_from_json(DEFAULT)
    end
    return state
end

local function inspect(record)
    local state = state_data(record.state)
    local live = obs.obs_data_get_obj(state, "live")
    local style = live and obs.obs_data_get_obj(live, "style") or nil
    if not style then style = obs.obs_data_get_obj(state, "style") end
    local width = int(style and obs.obs_data_get_int(style, "width") or 960, 320, 3840)
    local height = int(style and obs.obs_data_get_int(style, "height") or 540, 180, 2160)
    local visible = live and obs.obs_data_get_bool(live, "visible") or false
    -- Scrolling moves already-painted text and does not need to blank the source.
    if style and obs.obs_data_get_string(style, "readingMode") == "scroll" and live then
        obs.obs_data_unset_user_value(live, "scroll")
    end
    local signature = live and obs.obs_data_get_json(live) or ""
    signature = signature .. ":" .. width .. ":" .. height
    release(style) release(live) release(state)
    return width, height, visible, signature
end

local function envelope(record)
    local response = obs.obs_data_create()
    local state = state_data(record.state)
    obs.obs_data_set_obj(response, "state", state)
    obs.obs_data_set_int(response, "revision", record.revision)
    obs.obs_data_set_int(response, "liveRevision", record.live_revision)
    obs.obs_data_set_int(response, "renderedLiveRevision", record.report_revision or -1)
    obs.obs_data_set_int(response, "pageCount", record.page_count or 0)
    obs.obs_data_set_double(response, "scrollMax", record.scroll_max or 0)
    obs.obs_data_set_double(response, "viewportHeight", record.viewport_height or 0)
    obs.obs_data_set_string(response, "name", obs.obs_source_get_name(record.source))
    obs.obs_data_set_string(response, "error", record.error or "")
    local text = obs.obs_data_get_json(response)
    release(state) release(response)
    return text
end

local function valid_state(state)
    if not state or obs.obs_data_get_int(state, "version") ~= 1 then return false end
    local style, live, draft = obs.obs_data_get_obj(state, "style"), obs.obs_data_get_obj(state, "live"),
        obs.obs_data_get_obj(state, "draft")
    local items = obs.obs_data_get_array(state, "items")
    local ok = style ~= nil and live ~= nil and draft ~= nil and items ~= nil
    if items then
        ok = ok and obs.obs_data_array_count(items) <= 300
        for i = 0, obs.obs_data_array_count(items) - 1 do
            local item = obs.obs_data_array_item(items, i)
            ok = ok and #obs.obs_data_get_string(item, "text") <= 48000 and
                #obs.obs_data_get_string(item, "title") <= 400 and #obs.obs_data_get_string(item, "id") <= 120
            release(item)
        end
        obs.obs_data_array_release(items)
    end
    if draft then ok = ok and #obs.obs_data_get_string(draft, "text") <= 48000 end
    if live then ok = ok and #obs.obs_data_get_string(live, "text") <= 48000 end
    release(style) release(live) release(draft)
    return ok
end

local function set_state(record, text)
    if record.state == text then return end
    record.state = text
    record.revision = next_revision()
    local width, height, visible, signature = inspect(record)
    if signature ~= record.signature then
        record.signature = signature
        record.live_revision = record.revision
        record.ready_at = math.huge
    end
    record.width, record.height, record.visible = width, height, visible
    local settings = obs.obs_source_get_settings(record.source)
    obs.obs_data_set_string(settings, "letter_state", text)
    obs.obs_source_update(record.source, settings)
    release(settings)
    save_at = clock() + 0.8
end

local function poll()
    -- OBS supplies current_lua_script for timer callbacks, but not for the
    -- destroy callbacks it invokes while undefining a script's source type.
    -- The Lua hotkey wrapper dereferences that context, so defer individual
    -- source cleanup here. Whole-script removal unregisters callbacks in OBS.
    local retired = retired_hotkeys
    retired_hotkeys = {}
    for _, callback in ipairs(retired) do obs.obs_hotkey_unregister(callback) end
    if server then server.poll() end
    Webfonts.poll(clock)
    if save_at and clock() >= save_at then
        save_at = nil
        if obs.obs_frontend_save then obs.obs_frontend_save() end
    end
end

local function handle(method, path, query, body, headers)
    if method == "GET" and path == "/api/font" then
        if not font_families then font_families, font_error = Fonts.list(default_font) end
        local known = false
        for _, family in ipairs(font_families) do if family == query.name then known = true break end end
        if not known then return 404, "一覧にないフォントです。PCにある書体を一覧から選んでください。" end
        local data, mime, pending = Webfonts.get(query.name)
        if pending then return 202, "{}", JSON end
        if not data then return 422, mime end
        return 200, data, mime
    end
    if method == "GET" and path == "/api/environment" then
        local root, video = obs.obs_data_create(), obs.obs_video_info()
        obs.obs_data_set_string(root, "platform", ffi.os)
        obs.obs_data_set_string(root, "defaultFont", default_font)
        if obs.obs_get_video_info(video) then
            obs.obs_data_set_int(root, "canvasWidth", video.base_width)
            obs.obs_data_set_int(root, "canvasHeight", video.base_height)
        end
        local text = obs.obs_data_get_json(root) release(root)
        return 200, text, JSON
    end
    if method == "GET" and path == "/api/fonts" then
        if not font_families then font_families, font_error = Fonts.list(default_font) end
        local root, array = obs.obs_data_create(), obs.obs_data_array_create()
        for _, family in ipairs(font_families) do
            local item = obs.obs_data_create()
            obs.obs_data_set_string(item, "family", family)
            obs.obs_data_array_push_back(array, item) release(item)
        end
        obs.obs_data_set_array(root, "fonts", array)
        obs.obs_data_set_string(root, "error", font_error or "")
        local text = obs.obs_data_get_json(root)
        obs.obs_data_array_release(array) release(root)
        return 200, text, JSON
    end
    if method == "GET" and path == "/api/sources" then
        local root, array = obs.obs_data_create(), obs.obs_data_array_create()
        for id, record in pairs(records) do
            local entry = obs.obs_data_create()
            obs.obs_data_set_string(entry, "id", id)
            obs.obs_data_set_string(entry, "name", obs.obs_source_get_name(record.source))
            obs.obs_data_array_push_back(array, entry)
            release(entry)
        end
        obs.obs_data_set_array(root, "sources", array)
        local text = obs.obs_data_get_json(root)
        obs.obs_data_array_release(array) release(root)
        return 200, text, JSON
    end
    local kind, id = path:match("^/api/([a-z]+)/([%w%-]+)$")
    local record = id and records[id]
    if not record then return 404, "ソースが見つかりません。OBSから操作画面を開き直してください。" end
    if method == "GET" and kind == "state" then return 200, envelope(record), JSON end
    if method ~= "POST" or headers["content-type"] ~= "application/json" then
        return 400, "利用できないリクエスト形式です。"
    end
    local request = obs.obs_data_create_from_json(body)
    if not request then return 400, "データを読み取れませんでした。" end
    if kind == "report" then
        if obs.obs_data_get_int(request, "liveRevision") == record.live_revision then
            record.report_revision = record.live_revision
            record.page_count = int(obs.obs_data_get_int(request, "pageCount"), 1, 10000)
            record.scroll_max = math.max(0, math.min(10000000, obs.obs_data_get_double(request, "scrollMax")))
            record.viewport_height = math.max(0, math.min(2160, obs.obs_data_get_double(request, "viewportHeight")))
            record.ready_at = clock() + 0.08
        end
        release(request)
        return 200, "{}", JSON
    end
    if kind ~= "state" then release(request) return 404, "操作が見つかりません。" end
    if obs.obs_data_get_int(request, "expectedRevision") ~= record.revision then
        release(request)
        return 409, envelope(record), JSON
    end
    local state = obs.obs_data_get_obj(request, "state")
    if not valid_state(state) then
        release(state) release(request)
        return 400, "お便りの数・文字数、またはファイル形式を確認してください。"
    end
    set_state(record, obs.obs_data_get_json(state))
    release(state) release(request)
    return 200, envelope(record), JSON
end

local function ensure_server()
    if server or server_error then return server end
    local ok, value = pcall(function()
        local assets = {}
        local files = { ["control.html"] = "text/html; charset=utf-8", ["display.html"] = "text/html; charset=utf-8",
            ["core.js"] = "text/javascript; charset=utf-8", ["control.js"] = "text/javascript; charset=utf-8",
            ["display.js"] = "text/javascript; charset=utf-8", ["themes.js"] = "text/javascript; charset=utf-8",
            ["imports.js"] = "text/javascript; charset=utf-8",
            ["style.css"] = "text/css; charset=utf-8" }
        for name, mime in pairs(files) do
            local file = assert(io.open(ROOT .. "web/" .. name, "rb"), "同梱のwebフォルダが見つかりません。")
            local content = file:read("*a")
            file:close()
            assets["/" .. name] = {body = content, mime = mime}
        end
        assets["/"] = assets["/control.html"]
        return Http.start({assets = assets, handle = handle, clock = clock})
    end)
    if ok then
        server = value
        obs.timer_add(poll, 10)
    else
        server_error = tostring(value)
        obs.script_log(obs.LOG_ERROR, "お便りテキスト: " .. server_error)
    end
    return server
end

local function control_url(record)
    return server.origin .. "/control.html?token=" .. server.token .. (record and "&source=" .. record.id or "")
end

local function shortcut(record, action)
    if record.destroyed or not record.visible then return end
    local state = state_data(record.state)
    local live = obs.obs_data_get_obj(state, "live")
    if action == "hide" then obs.obs_data_set_bool(live, "visible", false)
    else
        local style = obs.obs_data_get_obj(live, "style")
        if style and obs.obs_data_get_string(style, "readingMode") == "scroll" then
            local step = record.scroll_max and record.scroll_max > 0 and 0.85 * record.viewport_height / record.scroll_max or 0
            local position = obs.obs_data_get_double(live, "scroll") + (action == "next" and step or -step)
            obs.obs_data_set_double(live, "scroll", math.max(0, math.min(1, position)))
        else
            local page = obs.obs_data_get_int(live, "page")
            local count = record.page_count or 1
            obs.obs_data_set_int(live, "page", int(page + (action == "next" and 1 or -1), 0, math.max(0, count - 1)))
        end
        release(style)
    end
    obs.obs_data_set_obj(state, "live", live)
    set_state(record, obs.obs_data_get_json(state))
    release(live) release(state)
end

local source = {id = "jp_letter_source", type = obs.OBS_SOURCE_TYPE_INPUT,
    output_flags = bit.bor(obs.OBS_SOURCE_VIDEO, obs.OBS_SOURCE_CUSTOM_DRAW), icon_type = obs.OBS_ICON_TYPE_TEXT}

source.get_name = function() return "日本語お便りテキスト（マシュマロ向け）" end
source.get_defaults = function(settings) obs.obs_data_set_default_string(settings, "letter_state", DEFAULT) end
source.create = function(settings, parent)
    -- Some libobs versions assign the restored UUID after the create callback.
    -- Keep a persistent panel key, and allocate another for a duplicated source.
    local key = obs.obs_data_get_string(settings, "letter_key")
    if key == "" or records[key] then key = obs.obs_source_get_uuid(parent) end
    obs.obs_data_set_string(settings, "letter_key", key)
    local revision = next_revision()
    local record = {source = parent, id = key, revision = revision, live_revision = revision,
        report_revision = -1, page_count = 1, ready_at = math.huge, state = obs.obs_data_get_string(settings, "letter_state"),
        hotkeys = {}, hotkey_callbacks = {}}
    record.width, record.height, record.visible, record.signature = inspect(record)
    records[record.id] = record
    if ensure_server() then
        local child_settings = obs.obs_data_create()
        obs.obs_data_set_string(child_settings, "url", server.origin .. "/display.html?token=" .. server.token .. "&source=" .. record.id)
        obs.obs_data_set_int(child_settings, "width", record.width)
        obs.obs_data_set_int(child_settings, "height", record.height)
        obs.obs_data_set_int(child_settings, "fps", 30)
        obs.obs_data_set_bool(child_settings, "is_local_file", false)
        obs.obs_data_set_bool(child_settings, "shutdown", false)
        obs.obs_data_set_bool(child_settings, "restart_when_active", false)
        -- OBS ships Browser Source on macOS / Windows; no extra plugin is required.
        if obs.obs_get_latest_input_type_id("browser_source") then
            record.child = obs.obs_source_create_private("browser_source", "お便りの描画", child_settings)
        end
        release(child_settings)
        if record.child then
            -- Lua's source API cannot enumerate children. Forward visibility
            -- explicitly so CEF paints when OBS shows or activates this source.
            if obs.obs_source_showing(parent) then obs.obs_source_inc_showing(record.child) record.child_showing = true end
            if obs.obs_source_active(parent) then obs.obs_source_inc_active(record.child) record.child_active = true end
        end
        if not record.child then record.error = "OBSのブラウザソースが見つかりません。" end
    else record.error = server_error end
    for action, label in pairs({next = "次のページ", previous = "前のページ", hide = "非表示"}) do
        local callback = function(pressed) if pressed then shortcut(record, action) end end
        local id = obs.obs_hotkey_register_frontend("jp_letters." .. record.id .. "." .. action,
            obs.obs_source_get_name(parent) .. "：" .. label .. (action == "hide" and "" or "（スクロール時は上下）"), callback)
        record.hotkeys[action] = id
        record.hotkey_callbacks[action] = callback
        local saved = obs.obs_data_get_array(settings, "hotkey_" .. action)
        if saved then obs.obs_hotkey_load(id, saved) obs.obs_data_array_release(saved) end
    end
    return record
end

source.update = function(record, settings)
    local text = obs.obs_data_get_string(settings, "letter_state")
    if text ~= record.state then
        record.state, record.revision = text, next_revision()
        local width, height, visible, signature = inspect(record)
        if signature ~= record.signature then
            record.signature, record.live_revision = signature, record.revision
            record.ready_at = math.huge
        end
        record.width, record.height, record.visible = width, height, visible
    end
    if record.child and (record.child_width ~= record.width or record.child_height ~= record.height) then
        local child = obs.obs_data_create()
        obs.obs_data_set_int(child, "width", record.width)
        obs.obs_data_set_int(child, "height", record.height)
        obs.obs_source_update(record.child, child)
        release(child)
        record.child_width, record.child_height = record.width, record.height
    end
end

source.get_width = function(record) return record.width end
source.get_height = function(record) return record.height end
source.show = function(record)
    if record.child and not record.child_showing then obs.obs_source_inc_showing(record.child) record.child_showing = true end
end
source.hide = function(record)
    if record.child and record.child_showing then obs.obs_source_dec_showing(record.child) record.child_showing = false end
end
source.activate = function(record)
    if record.child and not record.child_active then obs.obs_source_inc_active(record.child) record.child_active = true end
end
source.deactivate = function(record)
    if record.child and record.child_active then obs.obs_source_dec_active(record.child) record.child_active = false end
end
source.video_render = function(record)
    if record.child and record.visible and record.report_revision == record.live_revision and clock() >= record.ready_at then
        obs.obs_source_video_render(record.child)
    end
end
source.get_properties = function(record)
    local props = obs.obs_properties_create()
    local info = record.error or "操作画面を開いたら、このプロパティは「OK」で閉じてください。本文の登録、プレビュー、並べ替え、表示の調整は操作画面で行えます。準備中の編集は、配信に表示するまで反映されません。"
    obs.obs_properties_add_text(props, "help", info, obs.OBS_TEXT_INFO)
    if server then
        local button = obs.obs_properties_add_button(props, "control", "お便りの操作画面を開く", function() return false end)
        obs.obs_property_button_set_type(button, obs.OBS_BUTTON_URL)
        obs.obs_property_button_set_url(button, control_url(record))
    end
    return props
end
source.save = function(record, settings)
    for action, id in pairs(record.hotkeys) do
        local array = obs.obs_hotkey_save(id)
        if array then
            obs.obs_data_set_array(settings, "hotkey_" .. action, array)
            obs.obs_data_array_release(array)
        end
    end
end
source.destroy = function(record)
    if record.destroyed then return end
    record.destroyed = true
    records[record.id] = nil
    -- A removed script can be added again while its scene sources still exist.
    -- Keep their bindings in the parent settings before OBS drops the callbacks.
    local settings = obs.obs_source_get_settings(record.source)
    source.save(record, settings)
    release(settings)
    for _, callback in pairs(record.hotkey_callbacks) do retired_hotkeys[#retired_hotkeys + 1] = callback end
    record.hotkey_callbacks, record.hotkeys = {}, {}
    if record.child then
        if record.child_active then obs.obs_source_dec_active(record.child) end
        if record.child_showing then obs.obs_source_dec_showing(record.child) end
        obs.obs_source_release(record.child)
        record.child = nil
        record.child_active, record.child_showing = false, false
    end
end

function script_description()
    return "<h3>日本語お便りテキスト 0.4.1</h3>マシュマロ読み配信などのお便りを、準備・表示・ページ切り替え・スクロールまで扱うソースです。<br><br>ソース追加から「日本語お便りテキスト（マシュマロ向け）」を選び、プロパティの「お便りの操作画面を開く」を押してください。<br><br>コピーした受信箱の確認・一括登録とテキスト／JSONファイルの取り込みに対応します。受信箱の自動取得機能は含みません。"
end
function script_load() ensure_server() end
function script_properties()
    local props = obs.obs_properties_create()
    if ensure_server() then
        local button = obs.obs_properties_add_button(props, "control", "お便りの操作画面を開く", function() return false end)
        obs.obs_property_button_set_type(button, obs.OBS_BUTTON_URL)
        obs.obs_property_button_set_url(button, control_url(nil))
    else obs.obs_properties_add_text(props, "error", server_error or "接続できませんでした。", obs.OBS_TEXT_INFO) end
    return props
end
function script_unload()
    -- Source settings already contain edits. The frontend owns saving during
    -- script removal/shutdown; calling it here can re-enter script teardown.
    save_at = nil
    if server then obs.timer_remove(poll) server.stop() end
    server = nil
    retired_hotkeys = {}
end

obs.obs_register_source(source)
