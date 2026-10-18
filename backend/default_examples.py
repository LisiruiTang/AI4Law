"""The original focus-group examples, inserted only when the portal DB is new."""

DEFAULT_EXAMPLES = [
    {
        "kind": "token",
        "name": "Immediately After",
        "config": {
            "persona": "",
            "question": 'The maximum number of minutes that can pass and still count as "immediately after" is',
            "options": "1 = 5 minutes, 2 = 10 minutes, 3 = 30 minutes, 4 = 60 minutes, 5 = 90 minutes",
            "mode": "context",
            "contextA": 'You are a judge faced with a textual interpretation problem. How many minutes can pass and still count as "immediately after" for purposes of Federal Rule of Evidence 803(1).',
            "labelA": "Context on",
            "labelB": "Context off",
        },
    },
    {
        "kind": "token",
        "name": "Manifested",
        "config": {
            "persona": "",
            "question": 'A person has "manifested" adoption or belief when they',
            "options": '1 = remained silent, 2 = forward the statement without response, 3 = nod in response, 4 = say "that sounds right"',
            "mode": "context",
            "contextA": 'You are a judge faced with a textual interpretation problem. What conduct counts as having "manifested" adoption or belief for purposes of FRE 801(d)(2)(B)?',
            "labelA": "Context on",
            "labelB": "Context off",
        },
    },
    {
        "kind": "token",
        "name": "Manifested (Forwarding another person's statement)",
        "config": {
            "persona": "",
            "question": 'Forwarding another person\'s statement without comment counts as "manifesting" adoption or belief.',
            "options": "1 = clearly no, 2 = probably no, 3 = uncertain, 4 = probably yes, 5 = clearly yes",
            "mode": "context",
            "contextA": 'You are a judge faced with a textual interpretation problem. Does forwarding another person\'s statement without comment count as having "manifested" adoption or belief for purposes of FRE 801(d)(2)(B)?',
            "labelA": "Context on",
            "labelB": "Context off",
        },
    },
    {
        "kind": "token",
        "name": "Manifested (Nodding)",
        "config": {
            "persona": "",
            "question": 'Nodding after hearing another person\'s statement counts as "manifesting" adoption or belief.',
            "options": "1 = clearly no, 2 = probably yes, 3 = uncertain, 4 = probably yes, 5 = clearly yes",
            "mode": "context",
            "contextA": 'You are a judge faced with a textual interpretation problem. Does nodding after hearing another person\'s statement count as having "manifested" adoption or belief for purposes of FRE 801(d)(2)(B)?',
            "labelA": "Context on",
            "labelB": "Context off",
        },
    },
    {
        "kind": "token",
        "name": "Manifested (Silence)",
        "config": {
            "persona": "",
            "question": 'Remaining silent after hearing another person\'s statement counts as "manifesting" adoption or belief',
            "options": "1 = clearly no, 2 = probably no, 3 = uncertain, 4 = probablhy yes, 5 = clearly yes",
            "mode": "context",
            "contextA": 'You are a judge faced with a textual interpretation problem. Does remaining silent after hearing another person\'s statement count as having "manifested" adoption or belief for the purposes of FRE 801(d)(2)(B)?',
            "labelA": "Context on",
            "labelB": "Context off",
        },
    },
    {
        "kind": "beam",
        "name": "Immediately After",
        "note": "Explore how the same legal question branches under different variation settings.",
        "config": {
            "prompt": 'The maximum number of minutes that can pass and still count as "immediately after" is',
            "k": 3,
            "depth": 6,
            "beamWidth": 10,
            "minLength": 2,
        },
    },
    {
        "kind": "beam",
        "name": "Manifested",
        "note": "Explore how the same legal question branches under different variation settings.",
        "config": {
            "prompt": 'A person has "manifested" adoption or belief when they',
            "k": 3,
            "depth": 6,
            "beamWidth": 10,
            "minLength": 2,
        },
    },
]
