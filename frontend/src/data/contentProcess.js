export const WEEKLY_GOAL_START = 5
export const DAILY_GOAL_RAMP = 3

export const PIPELINE_STAGES = [
  'planning',
  'filming',
  'editing',
  'review',
  'scheduling',
  'engagement',
  'iteration',
]

export const SEED_IDEAS = [
  {
    id: 'seed-cheap-olympic-bike',
    text: 'You have $200 — how fast can we do an Olympic? Cheap bike challenge',
    source: 'own',
    impact: 3,
    effort: 3,
    decision: 'pending',
  },
  {
    id: 'seed-black-goggles',
    text: 'Black goggles — see how straight you can go',
    source: 'own',
    impact: 3,
    effort: 3,
    decision: 'pending',
  },
  {
    id: 'seed-pugathlon',
    text: 'Pugathlon',
    source: 'own',
    impact: 3,
    effort: 3,
    decision: 'pending',
  },
]

export const STAGES = [
  {
    id: 'idea-generation',
    number: 1,
    title: 'Idea Generation',
    icon: '💡',
    accent: '#f59e0b',
    owners: ['Brennan', 'Garet', 'Rachel', 'Group'],
    skippable: false,
    summary: 'Build an idea queue over time and work through it.',
    branches: [
      {
        id: 'scan',
        title: 'Scanning others for content',
        detail: 'Watch what is already working. Capture formats, hooks, and angles worth remixing.',
      },
      {
        id: 'own',
        title: 'Our own ideas',
        detail: 'Brainstorming sessions, Slack channel drops, and voice memos.',
      },
    ],
  },
  {
    id: 'idea-selection',
    number: 2,
    title: 'Idea Selection',
    icon: '⚖️',
    accent: '#fb7185',
    owners: ['Brennan'],
    skippable: false,
    summary: 'Score by impact + effort, then approve by locking a filming date and a publish date. Those dates sync to the Notion calendar.',
    branches: [
      {
        id: 'score',
        title: 'Impact vs effort',
        detail: 'Score each queued idea. Highest impact-per-effort rises to the top.',
      },
    ],
  },
  {
    id: 'planning',
    number: 3,
    title: 'Planning + Scripting',
    icon: '📝',
    accent: '#60a5fa',
    owners: ['Claude', 'Brennan', 'Content editor (future hire)'],
    skippable: true,
    summary: 'Write from viral scripts and run the post / hook checklist.',
    branches: [
      {
        id: 'scripts',
        title: 'Claude + Brennan + viral scripts',
        detail: 'Use existing viral scripts as a base. Content editor is a future hire.',
      },
      {
        id: 'checklists',
        title: 'Post checklist / hook checklist',
        detail: 'What emotion will people feel? What do you want them to feel? Do they feel it?',
      },
    ],
    checklists: {
      hook: [
        { id: 'hook-stop', label: 'Hook stops the scroll in the first 1–2 seconds' },
        { id: 'hook-promise', label: 'Hook promises a clear payoff' },
        { id: 'hook-emotion', label: 'Hook names or implies the target emotion' },
      ],
      post: [
        { id: 'post-emotion-intent', label: 'What emotion are people going to feel?' },
        { id: 'post-emotion-want', label: 'What do you want them to feel when they watch it?' },
        { id: 'post-emotion-check', label: 'Do they actually feel it?' },
        { id: 'post-cta', label: 'There is a clear next action or loop' },
      ],
    },
  },
  {
    id: 'filming',
    number: 4,
    title: 'Filming',
    icon: '🎥',
    accent: '#a78bfa',
    owners: ['Filmer (hire)', 'Brennan', 'Garet'],
    skippable: true,
    summary: 'Take the shot list, go to the activity, film everything.',
    branches: [
      {
        id: 'shot-list',
        title: 'Shot list → activity → film',
        detail: 'Film every shot on the list before wrapping.',
      },
    ],
  },
  {
    id: 'editing',
    number: 5,
    title: 'Editing',
    icon: '✂️',
    accent: '#c084fc',
    owners: ['Brennan', 'Hire someone'],
    skippable: true,
    summary: 'Cut the piece and make the thumbnail.',
    branches: [
      {
        id: 'cut',
        title: 'Edit the footage',
        detail: 'Brennan or a hire cuts the video.',
      },
      {
        id: 'thumbnail',
        title: 'Thumbnail',
        detail: 'Thumbnail is part of editing, not an afterthought.',
      },
    ],
  },
  {
    id: 'review',
    number: 6,
    title: 'Review',
    icon: '👀',
    accent: '#34d399',
    owners: ['2 reviewers'],
    skippable: true,
    summary: 'Get feedback from 2 people before it ships.',
    branches: [
      {
        id: 'emotion',
        title: 'Does it make them feel the emotion?',
        detail: 'If the intended feeling is missing, it is not ready.',
      },
      {
        id: 'blockers',
        title: 'Hard blockers + specific tips',
        detail: 'Catch anything that would stop a post, plus concrete improvements.',
      },
    ],
  },
  {
    id: 'scheduling',
    number: 7,
    title: 'Scheduling / Release',
    icon: '📅',
    accent: '#22d3ee',
    owners: ['Brennan'],
    skippable: false,
    summary: 'Lock a time and publish. Some post types can skip earlier steps.',
    branches: [
      {
        id: 'skip-note',
        title: 'Not every post needs every step',
        detail: 'This pipeline is the core. Lighter formats may skip planning, filming, or review.',
      },
    ],
  },
  {
    id: 'engagement',
    number: 8,
    title: 'Comment Replying + Engagement',
    icon: '💬',
    accent: '#38bdf8',
    owners: ['Brennan', 'Garet', 'Rachel'],
    skippable: false,
    summary: 'For the 24 hours after the post is live, respond to every comment.',
    branches: [
      {
        id: '24h',
        title: 'First 24 hours',
        detail: 'Reply to all comments while the post is still being pushed.',
      },
    ],
  },
  {
    id: 'iteration',
    number: 9,
    title: 'Iteration + Learning Loop',
    icon: '🔁',
    accent: '#818cf8',
    owners: ['Group'],
    skippable: false,
    summary: 'One week after the post goes live, capture one improvement for next time.',
    branches: [
      {
        id: 'one-thing',
        title: 'One thing we could have improved',
        detail: 'Keep a running list. Answer this for every post, one week after it ships.',
      },
    ],
  },
  {
    id: 'reporting',
    number: 10,
    title: 'Target + Reporting',
    icon: '🎯',
    accent: '#f472b6',
    owners: ['Brennan'],
    skippable: false,
    summary: 'Weekly posting goal: 5/week at the start, ramp over time to 3/day.',
    branches: [
      {
        id: 'goal',
        title: '5 per week → 3 per day',
        detail: 'Hit the current weekly target, then raise volume until 3 posts a day is normal.',
      },
    ],
  },
]
