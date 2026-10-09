-- SPDX-License-Identifier: GPL-2.0-or-later
-- A bounded, nonblocking loopback server. OBS already embeds LuaJIT/FFI.
-- No external interpreter, process, LuaSocket installation or Internet service.
local ffi = require("ffi")
local bit = require("bit")
local M = {}
local windows, mac = ffi.os == "Windows", ffi.os == "OSX"

local declarations = [[
typedef struct { unsigned char bytes[16]; } jl_address;
]]
if windows then
    declarations = declarations .. [[
typedef uintptr_t jl_socket;
int WSAStartup(unsigned short, void *);
int WSACleanup(void);
jl_socket socket(int, int, int);
int bind(jl_socket, const void *, int);
int listen(jl_socket, int);
jl_socket accept(jl_socket, void *, int *);
int ioctlsocket(jl_socket, unsigned long, unsigned long *);
int recv(jl_socket, char *, int, int);
int send(jl_socket, const char *, int, int);
int closesocket(jl_socket);
int BCryptGenRandom(void *, unsigned char *, unsigned long, unsigned long);
]]
else
    declarations = declarations .. [[
typedef int jl_socket;
int socket(int, int, int);
int bind(int, const void *, unsigned int);
int listen(int, int);
int accept(int, void *, unsigned int *);
int fcntl(int, int, ...);
intptr_t recv(int, char *, size_t, int);
intptr_t send(int, const char *, size_t, int);
int close(int);
int setsockopt(int, int, int, const void *, unsigned int);
]]
end
-- FFI types persist across script reloads in a shared LuaJIT state.
if not pcall(ffi.typeof, "jl_socket") then ffi.cdef(declarations) end
local C = windows and ffi.load("ws2_32") or ffi.C
local invalid = ffi.cast("jl_socket", -1)

local function close_socket(fd)
    if windows then C.closesocket(fd) else C.close(fd) end
end

local function nonblocking(fd)
    if windows then
        local enabled = ffi.new("unsigned long[1]", 1)
        return C.ioctlsocket(fd, 0x8004667e, enabled) == 0
    end
    local flags = C.fcntl(fd, 3, ffi.new("int", 0))
    if flags < 0 then return false end
    if mac then
        local one = ffi.new("int[1]", 1)
        if C.setsockopt(fd, 0xffff, 0x1022, one, 4) ~= 0 then return false end
    end
    return C.fcntl(fd, 4, ffi.new("int", bit.bor(flags, mac and 4 or 0x800))) == 0
end

local function secret()
    local bytes
    if windows then
        local buffer = ffi.new("unsigned char[32]")
        if ffi.load("bcrypt").BCryptGenRandom(nil, buffer, 32, 2) ~= 0 then
            error("操作画面の接続キーを作成できませんでした。")
        end
        bytes = ffi.string(buffer, 32)
    else
        local file = assert(io.open("/dev/urandom", "rb"))
        bytes = file:read(32)
        file:close()
        assert(bytes and #bytes == 32, "接続キーを作成できませんでした。")
    end
    return (bytes:gsub(".", function(c) return string.format("%02x", c:byte()) end))
end

local reasons = { [200] = "OK", [202] = "Accepted", [400] = "Bad Request", [403] = "Forbidden",
    [404] = "Not Found", [409] = "Conflict", [413] = "Payload Too Large", [422] = "Unprocessable Content", [500] = "Internal Server Error" }
local function response(status, body, mime)
    body = body or ""
    return "HTTP/1.1 " .. status .. " " .. (reasons[status] or "Error") .. "\r\n" ..
        "Content-Type: " .. (mime or "text/plain; charset=utf-8") .. "\r\n" ..
        "Content-Length: " .. #body .. "\r\nConnection: close\r\nCache-Control: no-store\r\n" ..
        "X-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\n" ..
        "Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " ..
        "img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'\r\n\r\n" .. body
end

function M.start(options)
    if windows then
        local data = ffi.new("unsigned char[512]")
        assert(C.WSAStartup(0x202, data) == 0, "ローカル接続を開始できませんでした。")
    end
    local listener, port
    for candidate = options.first_port or 17760, (options.first_port or 17760) + 30 do
        local fd = C.socket(2, 1, 6)
        if fd ~= invalid then
            local address = ffi.new("jl_address")
            address.bytes[0], address.bytes[1] = mac and 16 or 2, mac and 2 or 0
            address.bytes[2], address.bytes[3] = math.floor(candidate / 256), candidate % 256
            address.bytes[4], address.bytes[7] = 127, 1
            if nonblocking(fd) and C.bind(fd, address, 16) == 0 and C.listen(fd, 16) == 0 then
                listener, port = fd, candidate
                break
            end
            close_socket(fd)
        end
    end
    if not listener then
        if windows then C.WSACleanup() end
        error("操作画面の接続を開始できませんでした。OBSを再起動してください。")
    end
    local made, token = pcall(secret)
    if not made then
        close_socket(listener)
        if windows then C.WSACleanup() end
        error(token)
    end
    local server = { port = port, token = token, clients = {}, stopped = false }
    server.origin = "http://127.0.0.1:" .. port
    local buffer = ffi.new("char[16384]")
    local clock = options.clock or os.clock
    local max_bytes = options.max_bytes or 1048576
    local function finish(client, status, body, mime)
        client.output, client.sent = response(status, body, mime), 0
        client.input = ""
        if mime == "font/ttf" or mime == "font/otf" then client.deadline = clock() + 15 end
    end
    local function dispatch(client)
        local boundary = client.input:find("\r\n\r\n", 1, true)
        if not boundary then
            if #client.input > 8192 then finish(client, 413, "リクエストが大きすぎます。") end
            return
        end
        if boundary > 8192 then finish(client, 413, "リクエストが大きすぎます。") return end
        local head = client.input:sub(1, boundary - 1)
        local method, target = head:match("^(%u+) ([^%s]+) HTTP/1%.[01]\r\n")
        if not method then finish(client, 400, "リクエストを確認してください。") return end
        local headers = {}
        for key, value in head:gmatch("\r\n([^:%s]+):[ \t]*([^\r\n]*)") do
            key = key:lower()
            if headers[key] then finish(client, 400, "ヘッダーが重複しています。") return end
            headers[key] = value
        end
        if headers.host ~= "127.0.0.1:" .. port or
            (headers.origin and headers.origin ~= server.origin) then
            finish(client, 403, "この接続からは利用できません。") return
        end
        if headers["transfer-encoding"] then finish(client, 400, "利用できない形式です。") return end
        local length = headers["content-length"] or "0"
        if not length:match("^%d+$") then finish(client, 400, "本文の長さを確認してください。") return end
        length = tonumber(length)
        if length > max_bytes then finish(client, 413, "一度に取り込むお便りを減らしてください。") return end
        if #client.input < boundary + 3 + length then return end
        local path = target:match("^[^?]+")
        local query = {}
        for key, value in target:gmatch("[?&]([^=&]+)=([^&]*)") do
            query[key] = (value:gsub("%%(%x%x)", function(h) return string.char(tonumber(h, 16)) end))
        end
        if path:match("^/api/") and (headers["x-obs-letters-token"] or query.token) ~= server.token then
            finish(client, 403, "操作画面をOBSから開き直してください。") return
        end
        if method == "GET" and options.assets[path] then
            local asset = options.assets[path]
            finish(client, 200, asset.body, asset.mime)
            return
        end
        local ok, status, body, mime = pcall(options.handle, method, path, query,
            client.input:sub(boundary + 4, boundary + 3 + length), headers)
        if not ok then finish(client, 500, "処理を完了できませんでした。")
        else finish(client, status, body, mime) end
    end

    function server.poll()
        if server.stopped then return end
        local count = 0
        for _ in pairs(server.clients) do count = count + 1 end
        for _ = 1, math.max(0, 12 - count) do
            local fd = C.accept(listener, nil, nil)
            if fd == invalid then break end
            if nonblocking(fd) then
                server.clients[tostring(fd)] = {fd = fd, input = "", deadline = clock() + 5}
            else close_socket(fd) end
        end
        local started = clock()
        for key, client in pairs(server.clients) do
            local closed = clock() > client.deadline
            if not closed and not client.output then
                for _ = 1, 4 do
                    local n = tonumber(C.recv(client.fd, buffer, 16384, 0))
                    if n == 0 then closed = true break end
                    if n < 0 then break end
                    client.input = client.input .. ffi.string(buffer, n)
                    if #client.input > max_bytes + 8192 then
                        finish(client, 413, "一度に取り込むお便りを減らしてください。") break
                    end
                end
                if not closed then dispatch(client) end
            end
            if not closed and client.output then
                for _ = 1, 4 do
                    local remaining = client.output:sub(client.sent + 1, client.sent + 32768)
                    local n = tonumber(C.send(client.fd, remaining, #remaining, (not windows and not mac) and 0x4000 or 0))
                    if n <= 0 then break end
                    client.sent = client.sent + n
                    if client.sent == #client.output then break end
                end
                closed = client.sent == #client.output
            end
            if closed then close_socket(client.fd) server.clients[key] = nil end
            if clock() - started > 0.004 then break end
        end
    end

    function server.stop()
        if server.stopped then return end
        server.stopped = true
        for _, client in pairs(server.clients) do close_socket(client.fd) end
        server.clients = {}
        close_socket(listener)
        if windows then C.WSACleanup() end
    end
    return server
end

return M
