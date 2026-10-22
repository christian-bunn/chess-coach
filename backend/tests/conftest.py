import os

# The app under test doesn't load the voice model.
os.environ["COACH_VOICE"] = "off"
