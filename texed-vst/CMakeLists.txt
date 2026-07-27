cmake_minimum_required(VERSION 3.22)
project(Texed VERSION 0.1.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS TRUE)

# The two engines have to null against each other, so no fast-math and no
# x87 excess precision anywhere in this target. See "Audio identity" in the plan.
if(MSVC)
    set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
    add_compile_options(/fp:precise)
else()
    add_compile_options(-fno-fast-math -ffp-contract=off)
endif()

# JUCE lives here as a submodule; a local Dexed checkout is accepted as a
# fallback so a dev tree that already has one does not clone it twice.
set(TEXED_JUCE_PATH "${CMAKE_CURRENT_SOURCE_DIR}/libs/JUCE" CACHE PATH "Path to the JUCE source tree")
if(NOT EXISTS "${TEXED_JUCE_PATH}/CMakeLists.txt")
    set(TEXED_JUCE_PATH "${CMAKE_CURRENT_SOURCE_DIR}/../dexed-juce/libs/JUCE")
endif()
if(NOT EXISTS "${TEXED_JUCE_PATH}/CMakeLists.txt")
    message(FATAL_ERROR "JUCE not found. Run: git submodule update --init --recursive")
endif()
add_subdirectory("${TEXED_JUCE_PATH}" "${CMAKE_BINARY_DIR}/JUCE" EXCLUDE_FROM_ALL)

# Source/engine is the C++ side of the two-implementation engine: every file is a
# port of its namesake in texed-ts/packages/dx7-engine and has to stay numerically
# identical to it. Source/msfa is vendored DSP that both sides build on unchanged.
# Listed rather than globbed so an unused vendored file cannot creep into a build.
set(TEXED_ENGINE_SOURCES
    Source/NativeBridge.cpp
    Source/EngineMkI.cpp
    Source/EngineOpl.cpp
    Source/engine/amem.cpp
    Source/engine/compressor.cpp
    Source/engine/controllers.cpp
    Source/engine/dx7note.cpp
    Source/engine/engine_accuracy.cpp
    Source/engine/env.cpp
    Source/engine/env_tables.cpp
    Source/engine/lfo.cpp
    Source/engine/part.cpp
    Source/engine/part_config.cpp
    Source/engine/pitchenv.cpp
    Source/engine/plate_reverb.cpp
    Source/engine/plugin_fx.cpp
    Source/engine/porta.cpp
    Source/engine/synth_rack.cpp
    Source/engine/tables.cpp
    Source/engine/tuning.cpp
    Source/engine/voice.cpp
    Source/params/ParamIds.cpp
    Source/msfa/exp2.cc
    Source/msfa/fm_core.cc
    Source/msfa/fm_op_kernel.cc
    Source/msfa/freqlut.cc
    Source/msfa/sin.cc)

# The vendored msfa sources predate the CRT deprecations and are kept close to
# upstream so they stay diffable, so their warnings are silenced rather than fixed.
if(MSVC)
    set(TEXED_VENDOR_FLAGS /wd4100 /wd4146 /wd4244 /wd4267 /wd4996)
else()
    set(TEXED_VENDOR_FLAGS -Wno-conversion -Wno-deprecated-declarations)
endif()

# The React bundle, served to the WebView through the resource provider. Built
# with `pnpm build` in texed-ts; when it is missing the plugin falls back to a
# placeholder page. dev.ps1 points TEXED_LIVE_DIST at dist/ while watch rebuilds.
set(TEXED_WEBUI_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../texed-ts/dist" CACHE PATH "Built React bundle")
file(GLOB_RECURSE TEXED_WEBUI_FILES CONFIGURE_DEPENDS "${TEXED_WEBUI_DIR}/*")
list(FILTER TEXED_WEBUI_FILES EXCLUDE REGEX "/library/")
if(TEXED_WEBUI_FILES)
    juce_add_binary_data(TexedWebUI SOURCES ${TEXED_WEBUI_FILES})
else()
    message(WARNING "No web bundle at ${TEXED_WEBUI_DIR}; run `pnpm build` in texed-ts and configure again")
    juce_add_binary_data(TexedWebUI SOURCES "${CMAKE_CURRENT_SOURCE_DIR}/Source/fallback/index.html")
endif()
set_target_properties(TexedWebUI PROPERTIES POSITION_INDEPENDENT_CODE TRUE)

option(TEXED_COPY_AFTER_BUILD "Install the built plugin into the system plugin folders" OFF)

juce_add_plugin(Texed
    COMPANY_NAME "Wouter van Nifterick"
    COMPANY_WEBSITE "https://github.com/wvnifterick/dexed-web"
    BUNDLE_ID nl.woutervannifterick.texed
    # Deliberately unlike Dexed's com.digital-suburban.dexed / Dexd, so both can
    # be installed side by side and a host cannot confuse their states.
    PLUGIN_MANUFACTURER_CODE Wvnf
    PLUGIN_CODE Txed
    FORMATS VST3 Standalone
    PRODUCT_NAME "Texed"
    DESCRIPTION "Multi-timbral FM synthesizer"
    VST3_CATEGORIES Instrument Synth
    IS_SYNTH TRUE
    NEEDS_MIDI_INPUT TRUE
    NEEDS_MIDI_OUTPUT FALSE
    IS_MIDI_EFFECT FALSE
    EDITOR_WANTS_KEYBOARD_FOCUS TRUE
    # Off by default: the system VST3 folder needs elevation on Windows.
    COPY_PLUGIN_AFTER_BUILD ${TEXED_COPY_AFTER_BUILD}
    NEEDS_WEBVIEW2 TRUE)

target_sources(Texed PRIVATE
    Source/PluginProcessor.cpp
    Source/PluginEditor.cpp
    Source/WebAssets.cpp
    Source/Document.cpp
    Source/MidiRouter.cpp
    Source/params/Parameters.cpp
    ${TEXED_ENGINE_SOURCES})

target_include_directories(Texed PRIVATE Source)
target_compile_options(Texed PRIVATE ${TEXED_VENDOR_FLAGS})

target_compile_definitions(Texed PUBLIC
    JUCE_WEB_BROWSER=1
    JUCE_USE_WIN_WEBVIEW2_WITH_STATIC_LINKING=1
    JUCE_USE_CURL=0
    JUCE_VST3_CAN_REPLACE_VST2=0)

# Serve the built bundle from disk while `vite build --watch` is running, instead
# of the embedded BinaryData copy. Empty means use the embedded bundle only.
set(TEXED_LIVE_DIST "" CACHE PATH "Live dist folder for plugin UI dev (empty = embedded)")
if(TEXED_LIVE_DIST)
    target_compile_definitions(Texed PUBLIC TEXED_LIVE_DIST="${TEXED_LIVE_DIST}")
endif()

target_link_libraries(Texed PRIVATE
    TexedWebUI
    juce::juce_audio_utils
    juce::juce_gui_extra
    PUBLIC
    juce::juce_recommended_config_flags
    juce::juce_recommended_warning_flags)

# Headless renderer: the other half of the null test against apps/cli.
juce_add_console_app(texed-render PRODUCT_NAME "texed-render")

target_sources(texed-render PRIVATE
    Source/render/main.cpp
    ${TEXED_ENGINE_SOURCES})

target_include_directories(texed-render PRIVATE Source)
target_compile_options(texed-render PRIVATE ${TEXED_VENDOR_FLAGS})

target_compile_definitions(texed-render PRIVATE
    JUCE_WEB_BROWSER=0
    JUCE_USE_CURL=0
    JUCE_STANDALONE_APPLICATION=1)

target_link_libraries(texed-render PRIVATE
    juce::juce_audio_formats
    PUBLIC
    juce::juce_recommended_config_flags
    juce::juce_recommended_warning_flags)

# Editor-closed checks: the plugin's own shared code, driven without a window.
juce_add_console_app(texed-headless PRODUCT_NAME "texed-headless" NEEDS_WEBVIEW2 TRUE)

target_sources(texed-headless PRIVATE Source/test/headless.cpp)
target_include_directories(texed-headless PRIVATE Source)
target_compile_options(texed-headless PRIVATE ${TEXED_VENDOR_FLAGS})
# The checks pump the message loop by hand to let async parameter writes land.
target_compile_definitions(texed-headless PRIVATE JUCE_MODAL_LOOPS_PERMITTED=1)

include(packaging/packaging.cmake)
# The shared code links the GUI modules for the editor, which this never opens.
target_link_libraries(texed-headless PRIVATE
    Texed
    TexedWebUI
    juce::juce_audio_utils
    juce::juce_gui_extra)
