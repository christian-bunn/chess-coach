import os
import tempfile

# The app under test doesn't load the voice model.
os.environ["COACH_VOICE"] = "off"
# Nor does it touch the real puzzles.
os.environ["COACH_PROGRESS_DIR"] = tempfile.mkdtemp(prefix="chess-coach-test-")
