# Staging and installer targets.
#
#   cmake --build build --target texed-dist       stage the built artefacts
#   cmake --build build --target texed-installer   plus a Windows installer
#
# The installer target needs Inno Setup (iscc) on PATH; without it the stage is
# still produced and the installer step is skipped with a message.

set(TEXED_STAGE_DIR "${CMAKE_BINARY_DIR}/stage")
set(TEXED_INSTALLER_DIR "${CMAKE_BINARY_DIR}/installer")

add_custom_target(texed-dist
    COMMAND ${CMAKE_COMMAND} -E rm -rf "${TEXED_STAGE_DIR}"
    COMMAND ${CMAKE_COMMAND} -E make_directory "${TEXED_STAGE_DIR}")

# Each format lands in its own subdirectory, which is what installer.iss reads.
function(texed_stage format)
    if(NOT TARGET Texed_${format})
        return()
    endif()
    add_dependencies(texed-dist Texed_${format})
    add_custom_command(TARGET texed-dist POST_BUILD
        COMMAND ${CMAKE_COMMAND}
            # The property holds generator expressions of its own, so it needs
            # a second pass before it names a path.
            "-DTEXED_SRC=$<GENEX_EVAL:$<TARGET_PROPERTY:Texed_${format},JUCE_PLUGIN_ARTEFACT_FILE>>"
            "-DTEXED_DST=${TEXED_STAGE_DIR}/${format}"
            -P "${CMAKE_CURRENT_LIST_DIR}/copy-artefact.cmake")
endfunction()

texed_stage(VST3)
texed_stage(Standalone)
texed_stage(AU)
texed_stage(CLAP)

if(NOT WIN32)
    return()
endif()

# Fetched at build time rather than committed: it is a Microsoft-signed binary
# that supersedes itself, so a checked-in copy would only go stale.
set(TEXED_WEBVIEW2_BOOTSTRAPPER "${CMAKE_BINARY_DIR}/MicrosoftEdgeWebview2Setup.exe")

add_custom_target(texed-webview2-bootstrapper
    COMMAND ${CMAKE_COMMAND} -DTEXED_OUT=${TEXED_WEBVIEW2_BOOTSTRAPPER}
        -P "${CMAKE_CURRENT_LIST_DIR}/fetch-webview2.cmake"
    BYPRODUCTS ${TEXED_WEBVIEW2_BOOTSTRAPPER})

add_custom_target(texed-installer)
add_dependencies(texed-installer texed-dist texed-webview2-bootstrapper)

find_program(TEXED_ISCC iscc)
if(NOT TEXED_ISCC)
    add_custom_command(TARGET texed-installer POST_BUILD COMMAND ${CMAKE_COMMAND} -E echo
        "Inno Setup (iscc) not found; staged ${TEXED_STAGE_DIR} but built no installer")
    return()
endif()

# The library is optional: without a built web bundle there is nothing to ship.
set(TEXED_LIBRARY_ARG "")
if(EXISTS "${TEXED_WEBUI_DIR}/library")
    set(TEXED_LIBRARY_ARG /DLibrary=${TEXED_WEBUI_DIR}/library)
endif()

add_custom_command(TARGET texed-installer POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E make_directory "${TEXED_INSTALLER_DIR}"
    COMMAND "${TEXED_ISCC}" /Q
        /O"${TEXED_INSTALLER_DIR}"
        /DVersion=${PROJECT_VERSION}
        /DStaged=${TEXED_STAGE_DIR}
        /DBootstrapper=${TEXED_WEBVIEW2_BOOTSTRAPPER}
        ${TEXED_LIBRARY_ARG}
        "${CMAKE_CURRENT_LIST_DIR}/installer.iss"
    COMMAND ${CMAKE_COMMAND} -E echo "Installer in ${TEXED_INSTALLER_DIR}")
