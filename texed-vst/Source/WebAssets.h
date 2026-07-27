#pragma once

// Serves the built React bundle to the WebView out of BinaryData. The patch
// library is deliberately not embedded: it is megabytes of .syx and is served
// from a folder installed next to the plugin instead.

#include <juce_gui_extra/juce_gui_extra.h>
#include <optional>

namespace texed {

/** Resource provider for WebBrowserComponent::Options::withResourceProvider. */
std::optional<juce::WebBrowserComponent::Resource> lookupWebAsset(const juce::String& url);

/** Where the patch library was found, or a non-existent file if it was not. */
juce::File patchLibraryFolder();

/**
 * Whether the WebView2 runtime is installed. Without it the WebView is a blank
 * rectangle, so the editor says so rather than showing nothing.
 */
bool webViewRuntimeAvailable();

}  // namespace texed
