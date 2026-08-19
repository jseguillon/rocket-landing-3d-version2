name: Feature Request
about: Suggest an idea for this project
title: "feat: "
labels: ["enhancement"]
assignees: []

body:
  - type: markdown
    attributes:
      value: |
        Thanks for suggesting a feature! Please describe your idea below.

  - type: textarea
    id: problem
    attributes:
      label: Problem Statement
      description: Is your feature request related to a problem? Please describe.
      placeholder: I'm always frustrated when...
    validations:
      required: true

  - type: textarea
    id: solution
    attributes:
      label: Proposed Solution
      description: Describe the solution you'd like.
    validations:
      required: true

  - type: textarea
    id: alternatives
    attributes:
      label: Alternatives Considered
      description: Describe any alternative solutions or features you've considered.

  - type: textarea
    id: context
    attributes:
      label: Additional Context
      description: Add screenshots, mockups, or other context about the feature request.
