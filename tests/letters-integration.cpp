// SPDX-License-Identifier: GPL-2.0-or-later
// Loads the actual OBS Lua runtime; a browser stand-in tests the host separately
// from the real Chromium rendering exercised by letters-e2e.mjs.
#include <obs.h>
#include <obs-nix-platform.h>
#include <dlfcn.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <unistd.h>
#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>

namespace fs = std::filesystem;
static std::atomic<bool> lua_error{false};
static int letter_hotkeys()
{
    int count = 0;
    obs_enum_hotkeys([](void *data, obs_hotkey_id, obs_hotkey_t *key) {
        if (std::strncmp(obs_hotkey_get_name(key), "jp_letters.", 11) == 0) ++*static_cast<int *>(data);
        return true;
    }, &count);
    return count;
}
static void require(bool condition, const char *message) { if (!condition) throw std::runtime_error(message); }
static void synchronize() { obs_queue_task(OBS_TASK_GRAPHICS, [](void *) {}, nullptr, true); }
static void wait_hotkeys(int count)
{
    const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(3);
    while (letter_hotkeys() != count && std::chrono::steady_clock::now() < deadline)
        std::this_thread::sleep_for(std::chrono::milliseconds(10));
    require(letter_hotkeys() == count, "source hotkeys were not released");
}
static obs_hotkey_id next_hotkey()
{
    obs_hotkey_id found = OBS_INVALID_HOTKEY_ID;
    obs_enum_hotkeys([](void *data, obs_hotkey_id id, obs_hotkey_t *key) {
        const std::string name = obs_hotkey_get_name(key);
        if (name.rfind("jp_letters.", 0) == 0 && name.size() >= 5 && name.substr(name.size() - 5) == ".next")
            *static_cast<obs_hotkey_id *>(data) = id;
        return true;
    }, &found);
    require(found != OBS_INVALID_HOTKEY_ID, "next hotkey was not registered");
    return found;
}
static bool hotkey_binding_restored()
{
    struct Binding { obs_hotkey_id id; bool found = false; } check{next_hotkey()};
    obs_enum_hotkey_bindings([](void *data, size_t, obs_hotkey_binding_t *binding) {
        auto &check = *static_cast<Binding *>(data);
        const auto key = obs_hotkey_binding_get_key_combination(binding);
        if (obs_hotkey_binding_get_hotkey_id(binding) == check.id && key.key == OBS_KEY_F8 &&
            key.modifiers == (INTERACT_CONTROL_KEY | INTERACT_ALT_KEY)) check.found = true;
        return true;
    }, &check);
    return check.found;
}
static bool loopback_open(const std::string &url)
{
    const int fd = socket(AF_INET, SOCK_STREAM, 0); require(fd >= 0, "socket probe failed");
    sockaddr_in address{}; address.sin_family = AF_INET; address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    address.sin_port = htons(std::stoi(url.substr(url.find(':', url.find("//") + 2) + 1)));
    const bool connected = connect(fd, reinterpret_cast<sockaddr *>(&address), sizeof(address)) == 0;
    close(fd); return connected;
}

struct Browser { obs_source_t *source; std::string url; uint32_t width, height; gs_texture_t *texture; };
static std::vector<Browser *> browsers;
static void register_browser()
{
    obs_source_info info{};
    info.id = "browser_source"; info.type = OBS_SOURCE_TYPE_INPUT;
    info.output_flags = OBS_SOURCE_VIDEO | OBS_SOURCE_CUSTOM_DRAW;
    info.get_name = [](void *) { return "Browser integration stand-in"; };
    info.create = [](obs_data_t *settings, obs_source_t *source) -> void * {
        auto *browser = new Browser{source, obs_data_get_string(settings, "url"),
            static_cast<uint32_t>(obs_data_get_int(settings, "width")), static_cast<uint32_t>(obs_data_get_int(settings, "height")), nullptr};
        obs_enter_graphics();
        const uint8_t pixel[4] = {255, 255, 255, 255}; const uint8_t *pixels = pixel;
        browser->texture = gs_texture_create(1, 1, GS_RGBA, 1, &pixels, 0);
        obs_leave_graphics(); browsers.push_back(browser); return browser;
    };
    info.update = [](void *data, obs_data_t *settings) {
        auto *browser = static_cast<Browser *>(data);
        browser->width = static_cast<uint32_t>(obs_data_get_int(settings, "width"));
        browser->height = static_cast<uint32_t>(obs_data_get_int(settings, "height"));
    };
    info.get_width = [](void *data) { return static_cast<Browser *>(data)->width; };
    info.get_height = [](void *data) { return static_cast<Browser *>(data)->height; };
    info.video_render = [](void *data, gs_effect_t *) {
        auto *browser = static_cast<Browser *>(data);
        auto *effect = obs_get_base_effect(OBS_EFFECT_DEFAULT);
        gs_effect_set_texture(gs_effect_get_param_by_name(effect, "image"), browser->texture);
        while (gs_effect_loop(effect, "Draw")) gs_draw_sprite(browser->texture, 0, browser->width, browser->height);
    };
    info.destroy = [](void *data) {
        auto *browser = static_cast<Browser *>(data);
        browsers.erase(std::remove(browsers.begin(), browsers.end(), browser), browsers.end());
        obs_enter_graphics(); gs_texture_destroy(browser->texture); obs_leave_graphics(); delete browser;
    };
    obs_register_source(&info);
}

static bool rendered(obs_source_t *source)
{
    struct Frame { obs_source_t *source; bool visible = false; } frame{source};
    obs_queue_task(OBS_TASK_GRAPHICS, [](void *data) {
        auto &frame = *static_cast<Frame *>(data);
        obs_enter_graphics();
        auto *render = gs_texrender_create(GS_RGBA, GS_ZS_NONE);
        auto *stage = gs_stagesurface_create(16, 16, GS_RGBA);
        if (gs_texrender_begin(render, 16, 16)) {
            vec4 clear{}; gs_clear(GS_CLEAR_COLOR, &clear, 0, 0);
            gs_ortho(0, 960, 0, 540, -100, 100); gs_matrix_identity();
            obs_source_video_render(frame.source); gs_texrender_end(render);
            gs_stage_texture(stage, gs_texrender_get_texture(render));
            uint8_t *bytes = nullptr; uint32_t stride = 0;
            if (gs_stagesurface_map(stage, &bytes, &stride)) {
                for (int y = 0; y < 16; ++y) for (int x = 0; x < 16; ++x)
                    frame.visible |= bytes[y * stride + x * 4 + 3] != 0;
                gs_stagesurface_unmap(stage);
            }
        }
        gs_stagesurface_destroy(stage); gs_texrender_destroy(render); obs_leave_graphics();
    }, &frame, true);
    return frame.visible;
}

static void write_json(const fs::path &path, obs_data_t *data)
{
    const auto temporary = path.string() + ".tmp";
    { std::ofstream file(temporary); file << obs_data_get_json(data); }
    fs::rename(temporary, path);
}

int main(int argc, char **argv)
{
    std::cout.setf(std::ios::unitbuf);
    try {
        require(argc == 4 || argc == 5, "usage: letters-integration <sdk/usr> <project> <artifacts> [--lifecycle-only]");
        const bool lifecycle_only = argc == 5;
        const fs::path sdk = argv[1], project = argv[2], artifacts = argv[3];
        fs::create_directories(artifacts);
        auto *x11 = dlopen("libX11.so.6", RTLD_NOW); require(x11, "X11 missing");
        auto open_display = reinterpret_cast<void *(*)(const char *)>(dlsym(x11, "XOpenDisplay"));
        auto close_display = reinterpret_cast<int (*)(void *)>(dlsym(x11, "XCloseDisplay"));
        auto *display = open_display(nullptr); require(display, "DISPLAY missing");
        obs_set_nix_platform(OBS_NIX_PLATFORM_X11_EGL); obs_set_nix_platform_display(display);
        require(obs_startup("ja-JP", artifacts.c_str(), nullptr), "OBS startup failed");
        obs_audio_info audio{}; audio.samples_per_sec = 48000; audio.speakers = SPEAKERS_STEREO;
        require(obs_reset_audio(&audio), "audio initialization required for OBS destroy queue synchronization");
        const auto core = (sdk / "share/obs/libobs").string() + "/"; obs_add_data_path(core.c_str());
        const auto graphics = (sdk / "lib/x86_64-linux-gnu/libobs-opengl.so.30").string();
        obs_video_info video{}; video.graphics_module = graphics.c_str(); video.fps_num = 30; video.fps_den = 1;
        video.base_width = video.output_width = 1920; video.base_height = video.output_height = 1080;
        video.output_format = VIDEO_FORMAT_RGBA; video.colorspace = VIDEO_CS_709; video.range = VIDEO_RANGE_FULL; video.scale_type = OBS_SCALE_BILINEAR;
        require(obs_reset_video(&video) == OBS_VIDEO_SUCCESS, "OpenGL startup failed");
        register_browser();
        auto *runtime = dlopen((sdk / "lib/x86_64-linux-gnu/libobs-scripting.so.30").c_str(), RTLD_NOW | RTLD_GLOBAL);
        if (!runtime) throw std::runtime_error(dlerror());
        auto load = reinterpret_cast<bool (*)()>(dlsym(runtime, "obs_scripting_load"));
        auto unload = reinterpret_cast<void (*)()>(dlsym(runtime, "obs_scripting_unload"));
        auto create_script = reinterpret_cast<void *(*)(const char *, obs_data_t *)>(dlsym(runtime, "obs_script_create"));
        auto destroy_script = reinterpret_cast<void (*)(void *)>(dlsym(runtime, "obs_script_destroy"));
        auto reload_script = reinterpret_cast<bool (*)(void *)>(dlsym(runtime, "obs_script_reload"));
        auto loaded = reinterpret_cast<bool (*)(const void *)>(dlsym(runtime, "obs_script_loaded"));
        auto set_log = reinterpret_cast<void (*)(void (*)(void *, void *, int, const char *), void *)>(dlsym(runtime, "obs_scripting_set_log_callback"));
        set_log([](void *, void *, int level, const char *message) {
            std::cout << "LUA: " << message << '\n'; if (level <= LOG_ERROR) lua_error = true;
        }, nullptr);
        require(load(), "Lua runtime initialization failed");
        auto *script = create_script((project / "letters/jp-letters.lua").c_str(), nullptr);
        require(script && loaded(script) && !lua_error, "Lua script failed to load");
        auto *source = obs_source_create("jp_letter_source", "マシュマロのお便り", nullptr, nullptr);
        auto *other = obs_source_create("jp_letter_source", "お便りサブ", nullptr, nullptr);
        require(source && other && !lua_error, "Lua source creation failed");
        obs_source_inc_showing(source); synchronize();
        require(obs_source_get_width(source) == 960 && obs_source_get_height(source) == 540, "fixed canvas default failed");
        require(browsers.size() == 2 && !rendered(source), "initial output must be transparent");
        require(obs_source_showing(browsers[0]->source), "Lua source did not propagate browser visibility");
        obs_properties_t *props = obs_source_properties(source);
        auto *button = obs_properties_get(props, "control");
        require(button && obs_property_button_type(button) == OBS_BUTTON_URL, "operator panel button missing");
        auto *connection = obs_data_create();
        obs_data_set_string(connection, "control", obs_property_button_url(button));
        obs_data_set_string(connection, "display", browsers[0]->url.c_str());
        obs_data_set_string(connection, "sourceId", obs_source_get_uuid(source));
        obs_data_set_string(connection, "otherId", obs_source_get_uuid(other));
        write_json(artifacts / "connection.json", connection); obs_data_release(connection); obs_properties_destroy(props);
        std::cout << "PASS: real OBS Lua source loads; loopback server, panel button and transparent output start\n";
        const auto deadline = std::chrono::steady_clock::now() + std::chrono::minutes(5);
        while (!lifecycle_only && !fs::exists(artifacts / "stop") && std::chrono::steady_clock::now() < deadline) {
            require(!lua_error, "Lua runtime error during operations");
            auto *stats = obs_data_create();
            obs_data_set_bool(stats, "visible", rendered(source));
            obs_data_set_int(stats, "width", obs_source_get_width(source)); obs_data_set_int(stats, "height", obs_source_get_height(source));
            obs_data_set_int(stats, "children", static_cast<long long>(browsers.size()));
            obs_data_set_int(stats, "hotkeys", letter_hotkeys());
            auto *settings = obs_source_get_settings(source); obs_data_set_string(stats, "state", obs_data_get_string(settings, "letter_state"));
            obs_data_release(settings); write_json(artifacts / "native-stats.json", stats); obs_data_release(stats);
            if (fs::exists(artifacts / "hotkey.request")) {
                std::ifstream file(artifacts / "hotkey.request"); std::string action; file >> action;
                fs::remove(artifacts / "hotkey.request");
                auto *current = obs_source_get_settings(source);
                std::string name = std::string("jp_letters.") + obs_data_get_string(current, "letter_key") + "." + action;
                obs_data_release(current);
                struct Key { std::string name; obs_hotkey_id id = OBS_INVALID_HOTKEY_ID; } key{name};
                obs_enum_hotkeys([](void *data, obs_hotkey_id id, obs_hotkey_t *hotkey) {
                    auto &key = *static_cast<Key *>(data);
                    if (key.name == obs_hotkey_get_name(hotkey)) key.id = id;
                    return true;
                }, &key);
                require(key.id != OBS_INVALID_HOTKEY_ID, "source hotkey missing");
                obs_hotkey_enable_callback_rerouting(true);
                obs_hotkey_trigger_routed_callback(key.id, true);
                obs_hotkey_trigger_routed_callback(key.id, false);
                obs_hotkey_enable_callback_rerouting(false);
            }
            if (fs::exists(artifacts / "save.request")) {
                fs::remove(artifacts / "save.request"); auto *saved = obs_save_source(source); write_json(artifacts / "saved-source.json", saved); obs_data_release(saved);
            }
            if (fs::exists(artifacts / "restore.request")) {
                fs::remove(artifacts / "restore.request");
                auto *saved = obs_save_source(source);
                obs_source_dec_showing(source); obs_source_release(source); obs_wait_for_destroy_queue();
                source = obs_load_source(saved); require(source, "source restoration failed"); obs_source_load(source);
                obs_source_inc_showing(source); obs_data_release(saved); synchronize();
                require(browsers.size() == 2, "browser child leaked across restoration");
                require(letter_hotkeys() == 6, "old source hotkeys leaked across restoration");
                std::ofstream(artifacts / "restored") << "ok";
                std::cout << "PASS: OBS scene save/restore preserves queue, draft, live snapshot and fonts\n";
            }
            std::this_thread::sleep_for(std::chrono::milliseconds(80));
        }
        require(lifecycle_only || fs::exists(artifacts / "stop"), "browser test timeout");
        obs_source_release(other);
        obs_wait_for_destroy_queue(); obs_wait_for_destroy_queue(); wait_hotkeys(3);
        require(browsers.size() == 1, "ordinary source deletion leaked a browser child");
        std::cout << "PASS: ordinary source deletion releases its browser and hotkeys\n";

        obs_key_combination_t binding{INTERACT_CONTROL_KEY | INTERACT_ALT_KEY, OBS_KEY_F8};
        obs_hotkey_load_bindings(next_hotkey(), &binding, 1);
        require(hotkey_binding_restored(), "hotkey binding setup failed");
        obs_source_inc_active(source); synchronize();
        require(obs_source_active(browsers[0]->source) && obs_source_showing(browsers[0]->source), "active/showing browser setup failed");
        auto *saved_settings = obs_source_get_settings(source);
        const std::string saved_state = obs_data_get_string(saved_settings, "letter_state");
        obs_data_release(saved_settings);
        const std::string removed_url = browsers[0]->url;
        require(loopback_open(removed_url), "loopback server did not start");
        std::cout << "CHECK: remove script while an active, showing source remains in OBS\n";
        destroy_script(script); script = nullptr;
        obs_wait_for_destroy_queue(); obs_wait_for_destroy_queue(); wait_hotkeys(0);
        require(browsers.empty(), "script removal leaked a browser child");
        require(!loopback_open(removed_url), "script removal left its loopback listener open");
        require(!rendered(source), "removed script still renders");
        saved_settings = obs_source_get_settings(source);
        require(saved_state == obs_data_get_string(saved_settings, "letter_state"), "script removal lost source settings");
        obs_data_release(saved_settings);
        std::cout << "PASS: script removal with an active source keeps OBS alive and preserves settings\n";

        script = create_script((project / "letters/jp-letters.lua").c_str(), nullptr);
        require(script && loaded(script) && !lua_error, "script re-addition failed");
        require(browsers.size() == 1, "script re-addition did not restore exactly one child");
        require(obs_source_active(browsers[0]->source) && obs_source_showing(browsers[0]->source), "script re-addition lost child visibility");
        wait_hotkeys(3);
        require(hotkey_binding_restored(), "script re-addition lost hotkey bindings");
        for (int cycle = 0; cycle < 3; ++cycle) {
            require(reload_script(script), "script reload failed");
            obs_wait_for_destroy_queue(); obs_wait_for_destroy_queue(); wait_hotkeys(3);
            require(browsers.size() == 1, "script reload leaked or lost the browser child");
            require(obs_source_active(browsers[0]->source) && obs_source_showing(browsers[0]->source), "script reload lost child visibility");
            require(obs_source_get_width(source) == 960 && obs_source_get_height(source) == 540, "script reload lost source dimensions");
            require(hotkey_binding_restored(), "script reload lost hotkey bindings");
        }
        saved_settings = obs_source_get_settings(source);
        require(saved_state == obs_data_get_string(saved_settings, "letter_state"), "reload lost source settings");
        obs_data_release(saved_settings);
        std::cout << "PASS: script re-addition and repeated reload preserve sources without child or hotkey leaks\n";

        obs_source_dec_active(source); obs_source_dec_showing(source); obs_source_release(source);
        // Parent destruction queues child destruction behind the first sentinel.
        obs_wait_for_destroy_queue(); obs_wait_for_destroy_queue();
        require(browsers.empty(), "browser child leaked on source destruction");
        wait_hotkeys(0);
        destroy_script(script); unload(); require(!lua_error, "script cleanup failed"); obs_shutdown();
        close_display(display); dlclose(x11); dlclose(runtime);
        std::cout << "PASS: source destruction releases browser children, hotkeys and loopback sockets\n";
        return 0;
    } catch (const std::exception &error) { std::cerr << "FAIL: " << error.what() << '\n'; return 1; }
}
