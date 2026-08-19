name: Bug Report
about: Report a bug or unexpected behavior
title: "bug: "
labels: ["bug"]
assignees: []

body:
  - type: markdown
    attributes:
      value: |
        Thanks for taking the time to report a bug! Please fill out the information below.

  - type: input
    id: description
    attributes:
      label: Bug Description
      description: A clear and concise description of what the bug is.
    validations:
      required: true

  - type: textarea
    id: steps
    attributes:
      label: Steps to Reproduce
      description: Numbered steps to reproduce the behavior.
      value: |
        1. Go to '...'
        2. Click on '...'
        3. Scroll down to '...'
        4. See error
    validations:
      required: true

  - type: textarea
    id: expected
    attributes:
      label: Expected Behavior
      description: A clear and concise description of what you expected to happen.
    validations:
      required: true

  - type: dropdown
    id: browsers
    attributes:
      label: Browser / Environment
      description: Where does the bug occur?
      options:
        - Chrome (latest)
        - Firefox (latest)
        - Safari (latest)
        - Edge (latest)
        - Other / Mobile
    validations:
      required: true

  - type: input
    id: version
    attributes:
      label: Version
      description: Browser version or app version.
      placeholder: e.g., Chrome 120, Safari 17

  - type: textarea
    id: screenshots
    attributes:
      label: Screenshots / Videos
      description: If applicable, add screenshots or video recordings to help explain the problem.

  - type: textarea
    id: additional
    attributes:
      label: Additional Context
      description: Add any other context about the problem here.
