-- SPDX-License-Identifier: GPL-2.0-or-later
-- Read font family names from the host OS, without installing helper programs.
local ffi = require("ffi")
local M = {}

local function mac_fonts(add)
    if not pcall(ffi.typeof, "jl_cf_index") then ffi.cdef [[
        typedef intptr_t jl_cf_index;
        const void *CTFontManagerCopyAvailableFontFamilyNames(void);
        jl_cf_index CFArrayGetCount(const void *);
        const void *CFArrayGetValueAtIndex(const void *, jl_cf_index);
        unsigned char CFStringGetCString(const void *, char *, jl_cf_index, unsigned int);
        void CFRelease(const void *);
    ]] end
    local ct = ffi.load("/System/Library/Frameworks/CoreText.framework/CoreText")
    local cf = ffi.load("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation")
    local families = ct.CTFontManagerCopyAvailableFontFamilyNames()
    if families == nil then return end
    local buffer = ffi.new("char[1024]")
    for index = 0, tonumber(cf.CFArrayGetCount(families)) - 1 do
        local family = cf.CFArrayGetValueAtIndex(families, index)
        if cf.CFStringGetCString(family, buffer, 1024, 0x08000100) ~= 0 then add(ffi.string(buffer)) end
    end
    cf.CFRelease(families)
end

local function windows_fonts(add)
    if not pcall(ffi.typeof, "jl_logfontw") then ffi.cdef [[
        typedef struct {
            int height, width, escapement, orientation, weight;
            unsigned char italic, underline, strikeout, charset, out_precision,
                clip_precision, quality, pitch_family;
            unsigned short face[32];
        } jl_logfontw;
        void *GetDC(void *);
        int ReleaseDC(void *, void *);
        int WideCharToMultiByte(unsigned int, unsigned long, const unsigned short *,
            int, char *, int, const char *, int *);
        int EnumFontFamiliesExW(void *, jl_logfontw *,
            int (__stdcall *)(const jl_logfontw *, const void *, unsigned long, intptr_t),
            intptr_t, unsigned long);
    ]] end
    local gdi, user, kernel = ffi.load("gdi32"), ffi.load("user32"), ffi.load("kernel32")
    local dc = user.GetDC(nil)
    if dc == nil then return end
    local descriptor, buffer = ffi.new("jl_logfontw"), ffi.new("char[1024]")
    descriptor.charset = 1 -- DEFAULT_CHARSET: enumerate families for all scripts.
    local callback = ffi.cast("int (__stdcall *)(const jl_logfontw *, const void *, unsigned long, intptr_t)", function(font)
        local size = kernel.WideCharToMultiByte(65001, 0, font.face, -1, buffer, 1024, nil, nil)
        if size > 1 then add(ffi.string(buffer, size - 1)) end
        return 1
    end)
    gdi.EnumFontFamiliesExW(dc, descriptor, callback, 0, 0)
    callback:free()
    user.ReleaseDC(nil, dc)
end

local function linux_fonts(add)
    if not pcall(ffi.typeof, "jl_fc_fontset") then ffi.cdef [[
        typedef struct { int count, capacity; void **fonts; } jl_fc_fontset;
        int FcInit(void);
        void *FcPatternCreate(void);
        void FcPatternDestroy(void *);
        void *FcObjectSetCreate(void);
        int FcObjectSetAdd(void *, const char *);
        void FcObjectSetDestroy(void *);
        jl_fc_fontset *FcFontList(void *, void *, void *);
        int FcPatternGetString(const void *, const char *, int, unsigned char **);
        void FcFontSetDestroy(jl_fc_fontset *);
    ]] end
    local fc = ffi.load("libfontconfig.so.1")
    if fc.FcInit() == 0 then return end
    local pattern, objects = fc.FcPatternCreate(), fc.FcObjectSetCreate()
    if pattern == nil or objects == nil then
        if pattern ~= nil then fc.FcPatternDestroy(pattern) end
        if objects ~= nil then fc.FcObjectSetDestroy(objects) end
        return
    end
    fc.FcObjectSetAdd(objects, "family")
    local fonts, family = fc.FcFontList(nil, pattern, objects), ffi.new("unsigned char *[1]")
    if fonts ~= nil then
        for index = 0, tonumber(fonts.count) - 1 do
            if fc.FcPatternGetString(fonts.fonts[index], "family", 0, family) == 0 then add(ffi.string(family[0])) end
        end
        fc.FcFontSetDestroy(fonts)
    end
    fc.FcObjectSetDestroy(objects) fc.FcPatternDestroy(pattern)
end

function M.list(default_font)
    local families, found = {}, {}
    local function add(name)
        if name ~= "" and #name <= 480 and name:sub(1, 1) ~= "@" and not found[name] and #families < 3000 then
            found[name] = true families[#families + 1] = name
        end
    end
    local ok, error_message = pcall(function()
        if ffi.os == "OSX" then mac_fonts(add)
        elseif ffi.os == "Windows" then windows_fonts(add)
        else linux_fonts(add) end
    end)
    if #families == 0 then add(default_font) end
    table.sort(families)
    return families, ok and "" or tostring(error_message)
end

return M
