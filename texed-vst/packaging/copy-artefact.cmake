# Copies one built artefact into the stage. A script rather than `cmake -E`
# because a VST3 is a folder on Windows and a plain .exe next to it is not, and
# file(COPY) is the only copy that takes either.

file(MAKE_DIRECTORY "${TEXED_DST}")
file(COPY "${TEXED_SRC}" DESTINATION "${TEXED_DST}")
