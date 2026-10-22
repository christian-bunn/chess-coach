import os

# The app under test never calls Claude on its own: no plan usage or API spend from running tests.
os.environ["COACH_AI"] = "off"
