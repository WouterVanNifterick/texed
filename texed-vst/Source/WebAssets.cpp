#include "WebAssets.h"

#include <BinaryData.h>

namespace texed {

namespace {

juce::String mimeTypeFor(const juce::String& path) {
    if (path.endsWith(".html")) return "text/html";
    if (path.endsWith(".js") || path.endsWith(".mjs")) return "text/javascript";
    if (path.endsWith(".css")) return "text/css";
    if (path.endsWith(".json")) return "application/json";
    if (path.endsWith(".svg")) return "image/svg+xml";
    if (path.endsWith(".png")) return "image/png";
    if (path.endsWith(".woff2")) return "font/woff2";
    // .syx and anything else the library holds.
    return "application/octet-stream";
}

juce::File libraryRoot() {
    // The dev override first, so a tree with a built library can be used
    // without installing one.
    const auto fromEnv = juce::SystemStats::getEnvironmentVariable("TEXED_LIBRARY", {});
    if (fromEnv.isNotEmpty()) return juce::File(fromEnv);

    for (auto where : {juce::File::userApplicationDataDirectory,
                       juce::File::commonApplicationDataDirectory}) {
        const auto dir =
            juce::File::getSpecialLocation(where).getChildFile("Texed").getChildFile("library");
        if (dir.isDirectory()) return dir;
    }
    return {};
}

#ifdef TEXED_LIVE_DIST
juce::File liveDistRoot() {
    static const auto root = juce::File(TEXED_LIVE_DIST);
    return root;
}

/** Map a juce.backend URL to a file under the live dist folder. */
juce::File liveDistFile(const juce::String& url) {
    auto path = url.upToFirstOccurrenceOf("?", false, false)
                    .upToFirstOccurrenceOf("#", false, false);
    if (path.isEmpty() || path == "/") path = "/index.html";
    if (path.startsWith("/texed/")) path = path.fromFirstOccurrenceOf("/texed", false, false);
    return liveDistRoot().getChildFile(path.substring(1));
}

/** Serve one file from texed-ts/dist while `vite build --watch` is running. */
std::optional<juce::WebBrowserComponent::Resource> lookupLiveDistAsset(const juce::String& url) {
    const auto root = liveDistRoot();
    if (!root.isDirectory()) return std::nullopt;

    const auto file = liveDistFile(url);
    if (!file.existsAsFile() || !file.isAChildOf(root)) return std::nullopt;

    juce::MemoryBlock bytes;
    if (!file.loadFileAsData(bytes)) return std::nullopt;
    const auto* start = static_cast<const std::byte*>(bytes.getData());
    return juce::WebBrowserComponent::Resource{
        std::vector<std::byte>(start, start + bytes.getSize()),
        mimeTypeFor(file.getFileName())};
}
#endif

/** Serve one file out of the installed patch library, if the request is for one. */
std::optional<juce::WebBrowserComponent::Resource> lookupLibraryAsset(const juce::String& url) {
    const auto root = patchLibraryFolder();
    if (!root.isDirectory()) return std::nullopt;

    // Collections live in subfolders, so the whole relative path counts. The
    // file has to end up inside the library, whatever the URL asked for.
    const auto relative = url.fromFirstOccurrenceOf("/library/", false, false);
    const auto file = root.getChildFile(relative);
    if (relative.isEmpty() || !file.existsAsFile() || !file.isAChildOf(root)) return std::nullopt;

    juce::MemoryBlock bytes;
    if (!file.loadFileAsData(bytes)) return std::nullopt;
    const auto* start = static_cast<const std::byte*>(bytes.getData());
    return juce::WebBrowserComponent::Resource{std::vector<std::byte>(start, start + bytes.getSize()),
                                               mimeTypeFor(relative)};
}

}  // namespace

juce::File patchLibraryFolder() {
    static const auto root = libraryRoot();
    return root;
}

bool webViewRuntimeAvailable() {
#if JUCE_WINDOWS
    // The Evergreen runtime registers its version here; per-machine installs
    // land under HKLM (WOW6432Node on 64-bit), per-user under HKCU.
    static constexpr const char* kClient =
        "Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}\\pv";
    for (const auto* hive : {"HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\",
                             "HKEY_LOCAL_MACHINE\\SOFTWARE\\", "HKEY_CURRENT_USER\\SOFTWARE\\"}) {
        const auto version = juce::WindowsRegistry::getValue(juce::String(hive) + kClient);
        if (version.isNotEmpty() && version != "0.0.0.0") return true;
    }
    return false;
#else
    return true;
#endif
}

std::optional<juce::WebBrowserComponent::Resource> lookupWebAsset(const juce::String& url) {
    // Megabytes of .syx, so the library is installed beside the plugin rather
    // than embedded. Checked first: it owns the whole /library/ prefix.
    if (url.startsWith("/library/")) return lookupLibraryAsset(url);

#ifdef TEXED_LIVE_DIST
    if (auto live = lookupLiveDistAsset(url)) return live;
#endif

    // Vite emits hashed names under assets/, so the leaf name is unique and we
    // can match it against BinaryData's original filenames.
    const auto path = [&] {
        const auto bare = url.upToFirstOccurrenceOf("?", false, false)
                              .upToFirstOccurrenceOf("#", false, false);
        if (bare.isEmpty() || bare == "/") return juce::String("index.html");
        return bare.fromLastOccurrenceOf("/", false, false);
    }();

    for (int i = 0; i < BinaryData::namedResourceListSize; ++i) {
        if (juce::String(BinaryData::originalFilenames[i]) != path) continue;

        int size = 0;
        const auto* data = BinaryData::getNamedResource(BinaryData::namedResourceList[i], size);
        if (data == nullptr) break;

        const auto* bytes = reinterpret_cast<const std::byte*>(data);
        return juce::WebBrowserComponent::Resource{std::vector<std::byte>(bytes, bytes + size),
                                                   mimeTypeFor(path)};
    }
    return std::nullopt;
}

}  // namespace texed
