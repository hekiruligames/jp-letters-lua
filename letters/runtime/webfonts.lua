-- SPDX-License-Identifier: GPL-2.0-or-later
-- Read one installed OpenType face for a private, loopback-only preview.
-- No glyph subsetting, persistent font copies, or redistributed fonts.
local ffi, bit = require("ffi"), require("bit")
local M, cache, order, cache_bytes, jobs, queue = {}, {}, {}, 0, {}, {}
local MAX = 32 * 1024 * 1024
local MOD = 4294967296
local function fail(message) error(message, 0) end
local function u16(s, at)
    if at < 1 or at + 1 > #s then fail("フォントのデータを読み取れません。") end
    return s:byte(at) * 256 + s:byte(at + 1)
end
local function u32(s, at) return u16(s, at) * 65536 + u16(s, at + 2) end
local function be16(v) return string.char(math.floor(v / 256) % 256, v % 256) end
local function be32(v) return be16(math.floor(v / 65536)) .. be16(v % 65536) end
local function padded(s) return s .. string.rep("\0", (4 - #s % 4) % 4) end
local function checksum(s)
    local bytes, sum = ffi.cast("const unsigned char *", s), 0
    for at = 0, #s - 4, 4 do
        sum = (sum + bytes[at] * 16777216 + bytes[at + 1] * 65536 + bytes[at + 2] * 256 + bytes[at + 3]) % MOD
        if at % 32768 == 32764 then coroutine.yield() end
    end
    return sum
end

local function parse(raw, face)
    local offset = 0
    if raw:sub(1, 4) == "ttcf" then
        local count = u32(raw, 9)
        if count < 1 or count > 256 or face >= count then fail("フォントの書体を選択できません。") end
        offset = u32(raw, 13 + face * 4)
    end
    local signature = raw:sub(offset + 1, offset + 4)
    if signature ~= "\0\1\0\0" and signature ~= "OTTO" and signature ~= "true" then
        fail("この形式のフォントはローカルプレビューに対応していません。")
    end
    local count, tables = u16(raw, offset + 5), {}
    if count < 1 or count > 256 then fail("フォントのテーブルを読み取れません。") end
    for index = 0, count - 1 do
        local at = offset + 13 + index * 16
        local tag, start, length = raw:sub(at, at + 3), u32(raw, at + 8), u32(raw, at + 12)
        if #tag ~= 4 or start + length > #raw or tables[tag] then fail("フォントのテーブルが不正です。") end
        tables[tag] = raw:sub(start + 1, start + length)
    end
    return tables
end

local function pack(tables)
    local os2 = tables["OS/2"]
    if not os2 or #os2 < 10 then fail("埋め込みの許可を確認できないフォントです。") end
    local flags = u16(os2, 9)
    if bit.band(flags, 0x0002) ~= 0 or bit.band(flags, 0x0200) ~= 0 then
        fail("埋め込みが制限されたフォントです。通常のPC内フォント表示を使用します。")
    end
    if not tables.head or #tables.head < 12 then fail("フォントの基本情報を読み取れません。") end
    local tags, total = {}, 0
    for tag, data in pairs(tables) do
        tags[#tags + 1] = tag total = total + #data
        if total > MAX then fail("このフォントはローカルプレビューの上限32MBを超えています。") end
    end
    table.sort(tags)
    -- A digital signature no longer verifies after rebuilding a TTC face.
    tables.DSIG = nil
    for index = #tags, 1, -1 do if tags[index] == "DSIG" then table.remove(tags, index) end end
    local count, power, exponent = #tags, 1, 0
    while power * 2 <= count do power = power * 2 exponent = exponent + 1 end
    local header = (tables["CFF "] or tables.CFF2) and "OTTO" or "\0\1\0\0"
    header = header .. be16(count) .. be16(power * 16) .. be16(exponent) .. be16(count * 16 - power * 16)
    local directory, chunks, offset, head_offset = {}, {}, 12 + 16 * count
    for _, tag in ipairs(tags) do
        local data = tables[tag]
        if tag == "head" then
            data = data:sub(1, 8) .. "\0\0\0\0" .. data:sub(13) head_offset = offset
        end
        directory[#directory + 1] = tag .. be32(checksum(padded(data))) .. be32(offset) .. be32(#data)
        chunks[#chunks + 1] = padded(data) offset = offset + #chunks[#chunks]
    end
    local font = header .. table.concat(directory) .. table.concat(chunks)
    local adjustment = (0xB1B0AFBA - checksum(font)) % MOD
    font = font:sub(1, head_offset + 8) .. be32(adjustment) .. font:sub(head_offset + 13)
    return font, header:sub(1, 4) == "OTTO" and "font/otf" or "font/ttf"
end

local function mac_tables(name)
    if not pcall(ffi.typeof, "jl_wf_index") then ffi.cdef [[
        typedef intptr_t jl_wf_index;
        const void *CFStringCreateWithCString(const void *, const char *, unsigned int);
        const void *CTFontCreateWithName(const void *, double, const void *);
        const void *CTFontCopyAvailableTables(const void *, unsigned int);
        const void *CTFontCopyTable(const void *, unsigned int, unsigned int);
        const void *CTFontCopyFamilyName(const void *);
        jl_wf_index CFArrayGetCount(const void *);
        const void *CFArrayGetValueAtIndex(const void *, jl_wf_index);
        jl_wf_index CFDataGetLength(const void *);
        const unsigned char *CFDataGetBytePtr(const void *);
        unsigned char CFStringGetCString(const void *, char *, jl_wf_index, unsigned int);
        void CFRelease(const void *);
    ]] end
    local ct = ffi.load("/System/Library/Frameworks/CoreText.framework/CoreText")
    local cf = ffi.load("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation")
    local value = cf.CFStringCreateWithCString(nil, name, 0x08000100)
    if value == nil then fail("フォント名を読み取れません。") end
    local font = ct.CTFontCreateWithName(value, 48, nil) cf.CFRelease(value)
    if font == nil then fail("フォントを開けません。") end
    local ok, result = pcall(function()
        local family, buffer = ct.CTFontCopyFamilyName(font), ffi.new("char[1024]")
        if family == nil then fail("フォントを確認できません。") end
        local matched = cf.CFStringGetCString(family, buffer, 1024, 0x08000100) ~= 0 and ffi.string(buffer) == name
        cf.CFRelease(family)
        if not matched then fail("このフォント名の書体を確認できません。") end
        local available = ct.CTFontCopyAvailableTables(font, 0)
        if available == nil then fail("フォントのデータを取得できません。") end
        local good, tables = pcall(function()
            local count, found, total = tonumber(cf.CFArrayGetCount(available)), {}, 0
            if count > 256 then fail("フォントのテーブルが多すぎます。") end
            for index = 0, count - 1 do
                -- CoreText stores table tags as pointer-sized integers, not CFNumbers.
                local tag = tonumber(ffi.cast("uintptr_t", cf.CFArrayGetValueAtIndex(available, index)))
                local data = ct.CTFontCopyTable(font, tag, 0)
                if data ~= nil then
                    local size = tonumber(cf.CFDataGetLength(data)) total = total + size
                    if size < 0 or total > MAX then cf.CFRelease(data) fail("このフォントは32MBを超えています。") end
                    found[be32(tag)] = ffi.string(cf.CFDataGetBytePtr(data), size) cf.CFRelease(data)
                end
            end
            return found
        end)
        cf.CFRelease(available)
        if not good then fail(tables) end
        return tables
    end)
    cf.CFRelease(font)
    if not ok then fail(result) end
    return result
end

local function windows_tables(name)
    if not pcall(ffi.typeof, "jl_wf_logfontw") then ffi.cdef [[
        typedef struct {
            int height, width, escapement, orientation, weight;
            unsigned char italic, underline, strikeout, charset, out_precision, clip_precision, quality, pitch_family;
            unsigned short face[32];
        } jl_wf_logfontw;
        int MultiByteToWideChar(unsigned int, unsigned long, const char *, int, unsigned short *, int);
        void *CreateCompatibleDC(void *);
        void *CreateFontIndirectW(const jl_wf_logfontw *);
        void *SelectObject(void *, void *);
        unsigned long GetFontData(void *, unsigned long, unsigned long, void *, unsigned long);
        int DeleteObject(void *);
        int DeleteDC(void *);
    ]] end
    local gdi, kernel = ffi.load("gdi32"), ffi.load("kernel32")
    local descriptor = ffi.new("jl_wf_logfontw") descriptor.height = -48 descriptor.weight = 500 descriptor.charset = 1
    if kernel.MultiByteToWideChar(65001, 0, name, -1, descriptor.face, 32) == 0 then fail("フォント名を読み取れません。") end
    local dc, font = gdi.CreateCompatibleDC(nil), gdi.CreateFontIndirectW(descriptor)
    if dc == nil or font == nil then
        if dc ~= nil then gdi.DeleteDC(dc) end if font ~= nil then gdi.DeleteObject(font) end
        fail("フォントを開けません。")
    end
    local previous = gdi.SelectObject(dc, font)
    local ok, result = pcall(function()
        local function read(tag, offset, length)
            local size = length or tonumber(gdi.GetFontData(dc, tag, 0, nil, 0))
            if size <= 0 or size > MAX then fail("フォントのデータを取得できません。") end
            local buffer = ffi.new("unsigned char[?]", size)
            if tonumber(gdi.GetFontData(dc, tag, offset or 0, buffer, size)) ~= size then fail("フォントを読み取れません。") end
            return ffi.string(buffer, size)
        end
        local header = read(0, 0, 12)
        local count = u16(header, 5)
        if count < 1 or count > 256 then fail("この形式のフォントは未対応です。") end
        local directory, tables, total = read(0, 12, count * 16), {}, 0
        for index = 0, count - 1 do
            local tag = directory:sub(index * 16 + 1, index * 16 + 4)
            local little = tag:byte(1) + tag:byte(2) * 256 + tag:byte(3) * 65536 + tag:byte(4) * 16777216
            local data = read(little) total = total + #data
            if total > MAX then fail("このフォントは32MBを超えています。") end
            tables[tag] = data
        end
        return tables
    end)
    gdi.SelectObject(dc, previous) gdi.DeleteObject(font) gdi.DeleteDC(dc)
    if not ok then fail(result) end
    return result
end

local function linux_tables(name)
    ffi.cdef [[
        int FcPatternAddString(void *, const char *, const unsigned char *);
        int FcPatternAddInteger(void *, const char *, int);
        int FcConfigSubstitute(void *, void *, int);
        void FcDefaultSubstitute(void *);
        void *FcFontMatch(void *, void *, int *);
        int FcPatternGetInteger(const void *, const char *, int, int *);
    ]]
    local fc = ffi.load("libfontconfig.so.1")
    local pattern = fc.FcPatternCreate()
    if pattern == nil then fail("フォントを探せません。") end
    fc.FcPatternAddString(pattern, "family", ffi.cast("const unsigned char *", name))
    fc.FcPatternAddInteger(pattern, "weight", 100)
    fc.FcConfigSubstitute(nil, pattern, 0) fc.FcDefaultSubstitute(pattern)
    local match_result = ffi.new("int[1]")
    local matched = fc.FcFontMatch(nil, pattern, match_result) fc.FcPatternDestroy(pattern)
    if matched == nil then fail("フォントを探せません。") end
    local path, index = ffi.new("unsigned char *[1]"), ffi.new("int[1]")
    local file_name = fc.FcPatternGetString(matched, "file", 0, path) == 0 and ffi.string(path[0]) or nil
    fc.FcPatternGetInteger(matched, "index", 0, index) fc.FcPatternDestroy(matched)
    if not file_name then fail("フォントを開けません。") end
    local file = io.open(file_name, "rb")
    if not file then fail("フォントを開けません。") end
    local raw = file:read(MAX + 1) file:close()
    if not raw or #raw > MAX then fail("このフォントは32MBを超えています。") end
    return parse(raw, tonumber(index[0]) % 65536)
end

function M.get(name)
    if cache[name] then return unpack(cache[name]) end
    if not jobs[name] and #queue < 2 then
        jobs[name] = coroutine.create(function()
            local ok, font, mime = pcall(function()
                local tables
                if ffi.os == "OSX" then tables = mac_tables(name)
                elseif ffi.os == "Windows" then tables = windows_tables(name)
                else tables = linux_tables(name) end
                return pack(tables)
            end)
            if not ok then font, mime = false, tostring(font) end
            local size = font and #font or 0
            while #order >= 8 or cache_bytes + size > 64 * 1024 * 1024 do
                local oldest = table.remove(order, 1)
                cache_bytes = cache_bytes - (cache[oldest][1] and #cache[oldest][1] or 0) cache[oldest] = nil
            end
            cache[name] = {font, mime} order[#order + 1] = name cache_bytes = cache_bytes + size
        end)
        queue[#queue + 1] = name
    end
    return nil, nil, true
end

function M.poll(clock)
    local started = clock()
    while queue[1] and clock() - started < 0.003 do
        local name = queue[1]
        local ok = coroutine.resume(jobs[name])
        if not ok then cache[name] = {false, "フォントを読み込めませんでした。"} end
        if not ok or coroutine.status(jobs[name]) == "dead" then
            jobs[name] = nil table.remove(queue, 1)
        end
    end
end

return M
