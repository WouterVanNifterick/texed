# Downloads the WebView2 Evergreen bootstrapper to TEXED_OUT, once. Run as a
# script step by the texed-installer target, not included in the main build.

if(EXISTS "${TEXED_OUT}")
    return()
endif()

message(STATUS "Fetching the WebView2 Evergreen bootstrapper")
file(DOWNLOAD "https://go.microsoft.com/fwlink/p/?LinkId=2124703" "${TEXED_OUT}"
    STATUS status SHOW_PROGRESS TLS_VERIFY ON)

list(GET status 0 code)
if(NOT code EQUAL 0)
    file(REMOVE "${TEXED_OUT}")
    list(GET status 1 reason)
    message(FATAL_ERROR "Could not fetch the WebView2 bootstrapper: ${reason}")
endif()
