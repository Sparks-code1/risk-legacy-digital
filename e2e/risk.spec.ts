/**
 * Risk reaches a board, and the board can be played.
 *
 * THE FIRST BROWSER COVERAGE RISK HAS EVER HAD. Every spec beside this one is
 * Dune's, and the feature this walk goes through — a game against a computer
 * opponent — is the one nobody has played end to end.
 *
 * WHAT IT ASSERTS IS THE WALK, not the rules. Which faction was taken, which
 * territory an HQ landed on and how the dice fell are all somebody else's test
 * and all of them already have one. This asks the three questions the unit
 * suites cannot: did the screen arrive, is what is on it pressable, and is
 * anything lying on top of it.
 */
import { test, expect } from '@playwright/test'
import {
  soloGame, newCampaign, openSlots, playSetup, startGame, onBoard,
  whoseTurn, passTurn, territoryIdNamed, playRounds, gameOver, ageCampaign,
  clickTerritory,
} from './support/risk'

/**
 * The walk is a dozen screens with a save behind several of them.
 *
 * Longer than the file default because this one test IS the fixture the others
 * would have shared — there is no seeded position to open.
 */
test.setTimeout(240_000)

test('the front door opens Risk, and Risk opens a campaign', async ({ page }) => {
  await newCampaign(page)

  // THE JOIN CODE IS THE PROOF THE SERVER TOOK IT. A campaign that only lived
  // in the tab would render this screen just as well; the code is minted on
  // the row, so its presence says a write landed.
  //
  // .first() ON EVERY ONE. A text locator that resolves to five elements is a
  // strict-mode violation, not a pass — and "JOIN CODE" appears in the heading,
  // the label and the help line beneath it. What is being asked is whether the
  // screen says it at all.
  await expect(page.locator('text=JOIN CODE').first()).toBeVisible()
  await expect(page.locator('text=CAMPAIGN ROSTER').first()).toBeVisible()

  // Two names, which is the minimum a game needs — the screen says so itself
  // until the second one is added.
  await expect(page.locator('text=Harness').first()).toBeVisible()
  await expect(page.locator('text=Bot One').first()).toBeVisible()
  await expect(page.locator('text=A game needs at least 2 players')).toHaveCount(0)
})

test('a game against the computer reaches a board with a turn on it', async ({ page }) => {
  await soloGame(page)

  expect(await onBoard(page), 'setup finished but no phase controls arrived').toBe(true)

  // THE MAP IS THE GAME. A board that renders its panels and not its map looks
  // like a working app right up until you try to click a territory.
  //
  // A CANVAS HERE, POLYGONS IN THE HQ PICKER. The two maps in this app are not
  // the same map: setup draws an SVG with one polygon per territory, and the
  // board draws Pixi over a grey canvas base with an SVG layer for markers
  // only. A first version of this assertion counted polygons — the number the
  // picker gives — and found none on a board that was up and being played.
  const map = page.locator('canvas').first()
  await expect(map, 'the board arrived without a map to play on').toBeVisible()
  const box = await map.boundingBox()
  expect(box !== null && box.width > 200 && box.height > 150,
    `the map is present but ${box?.width ?? 0}x${box?.height ?? 0}`).toBe(true)

  // AND SOMETHING TO PRESS. A board arriving with no enabled control is a
  // soft-lock — the game is up, it is your turn, and there is nothing you can
  // do — which is the failure this whole run exists to catch.
  const live = page.locator('button:not([disabled])')
  expect(await live.count(), 'the board has no pressable control').toBeGreaterThan(0)
})

test('the player count chip sets the seats it names', async ({ page }) => {
  // A SEPARATE CAMPAIGN, because roster names are permanent and a second game
  // in the first one would be Game #2 with a roster of four.
  await newCampaign(page, { others: ['Bot One', 'Bot Two'] })

  // openSlots, NOT startGame: the assertion is about the slots screen, and
  // startGame leaves it. The first version of this test called startGame and
  // then counted AI toggles on the scar deal two screens later, where there
  // are none — it failed on its own helper and said nothing about the app.
  await openSlots(page, { players: 3, ai: [1, 2] })

  // Three seats asked for, three seats offered. The chips and the rows are
  // separate state, and a chip that highlights without moving the rows is a
  // control that looks like it worked.
  await expect(page.locator('button', { hasText: /^🤖 AI$/ })).toHaveCount(3)

  // AND THE TWO THAT WERE SET ARE THE TWO THAT ARE ON. Counting rows alone
  // would pass with every seat still human, which is the whole thing this
  // test is named for.
  //
  // aria-pressed, WHICH THE TOGGLE DID NOT HAVE. Its state lived only in a
  // background colour — unreadable to a screen reader and unassertable here
  // without matching rgba strings.
  await expect(page.locator('button[aria-pressed="true"]', { hasText: /^🤖 AI$/ }))
    .toHaveCount(2)
  await expect(page.locator('button[aria-pressed="true"]', { hasText: /^🧑 Human$/ }))
    .toHaveCount(1)
})

test('the computer makes its own setup choices', async ({ page }) => {
  // THE HARNESS CLICKS FOR "Harness" AND NOBODY ELSE. Every screen that asks
  // Bot One something has to be answered by Bot One, or the walk runs its cap
  // down waiting and fails naming the screen it stalled on.
  //
  // That is the whole assertion. Setup used to put the computer's faction, its
  // permanent ability and its HQ to the human at the keyboard — a solo player
  // made all of their opponents' opening decisions before playing against
  // them — and a walk that cheerfully clicked those could not tell the
  // difference before and after.
  await soloGame(page, { you: 'Harness', only: 'Harness', ai: [1] })

  expect(await onBoard(page), 'the computer never answered for itself').toBe(true)
})

test('two computers set up a game with nobody clicking for them', async ({ page }) => {
  // THREE SEATS, TWO OF THEM BOTS, and the walk still only answers for the
  // human. One bot answering could be a lucky ordering; two, in turn, through
  // faction, ability and HQ, is the sequencing working.
  await newCampaign(page, { others: ['Bot One', 'Bot Two'] })
  await startGame(page, { players: 3, ai: [1, 2] })
  await playSetup(page, 40, 'Harness')

  expect(await onBoard(page), 'two computers did not finish their own setup').toBe(true)

  // AND THE BOARD KNOWS ALL THREE. A bot that answered nothing would still let
  // the walk through if the screen simply skipped it; three seats on the board
  // is the proof each one actually took a faction and a piece of ground.
  const said = await page.locator('body').innerText()
  for (const who of ['Harness', 'Bot One', 'Bot Two']) {
    expect(said.includes(who), `${who} is not on the board`).toBe(true)
  }
})

test('the territory panel closes on its ×', async ({ page }) => {
  // The panel sits over the map, and the map's hit-test canvas has a z-index
  // of its own. For a while the panel had none, so every click on it — the ×
  // included — landed on the map underneath: the panel showed through the
  // transparent canvas and could not be touched. Playwright sees that as the
  // canvas intercepting the click, not as a click that landed and did nothing.
  await soloGame(page, { players: 2, ai: [1] })
  // NEUTRAL GROUND OPENS THE PANEL. The game opens in the draft, where a click
  // on your own territory places a troop there and opens nothing — so the
  // walk tries a run of territories two HQs are unlikely to have both taken,
  // and stops at the first that answers with a panel.
  const close = page.getByRole('button', { name: 'Close territory details' })
  for (const name of ['Brazil', 'Egypt', 'India', 'Ukraine', 'Peru', 'China']) {
    await clickTerritory(page, territoryIdNamed(name))
    if (await close.count()) break
  }
  await expect(close, 'no territory click opened its panel').toBeVisible()
  await close.click({ timeout: 10_000 })
  await expect(close, 'the panel is still open after its × was clicked').toHaveCount(0)
})
test('the computer takes a whole turn and hands control back', async ({ page }) => {
  // THE OLDEST OPEN QUESTION ABOUT RISK. The AI turn driver — reinforce, then
  // attack, then fortify, then end — has never been watched from one end to the
  // other. Its known failure is a stall: the driver reaches a state it has no
  // branch for, or leaves `aiBusyRef` set, and the turn silently stops. The
  // board then looks exactly like a human seat with nobody at it.
  //
  // There IS a 20-second stall watchdog that notices and offers a Nudge. That
  // is a symptom, not a pass, so this spec fails on the Nudge appearing as
  // surely as on the turn never coming back.
  //
  // WHAT IT DOES NOT ASK is whether the turn was PLAYED. A driver that handed
  // the seat straight on without reinforcing or attacking would pass this. An
  // attempt to close that — comparing what the computer held before and after,
  // via `holdings` in the support file — is not here because it could not be
  // made to fail: stubbing aiReinforcePlacements, aiAttackPlan and
  // aiFortifyMove all to nothing left the run green, so whatever moves those
  // numbers is not only them. An assertion nobody can make fail is worse than
  // no assertion, because it reads like cover. `holdings` is left in place —
  // it works, and a probe with it showed a real turn taking Bot One from one
  // territory to eight — for whoever works out what that path is.
  const claimed = await soloGame(page, { you: 'Harness', only: 'Harness', ai: [1] })
  expect(await onBoard(page), 'never reached a board').toBe(true)

  // WHOEVER THE DICE PUT FIRST. If the human opens, their turn is played out to
  // hand over; if the computer opens, the wait below is the whole test. Either
  // way exactly one full computer turn is watched, and the spec does not depend
  // on a roll.
  if ((await whoseTurn(page))?.toLowerCase() === 'harness') {
    const home = claimed['harness']
    expect(home, 'the walk did not record where Harness put her HQ').toBeTruthy()
    await passTurn(page, territoryIdNamed(home))
  }

  // THE COMPUTER IS UP. Asserted rather than assumed: a hand-over that quietly
  // skipped the bot would otherwise read as a pass two lines further down.
  await expect(page.locator('text=/is taking their turn/'),
    'the turn never reached the computer').toBeVisible({ timeout: 30_000 })

  // AND IT COMES BACK. Generous, because a turn is reinforce, some number of
  // battles with dice animations, and a fortify — but bounded, because "it
  // finishes eventually" is what a stalled AI also looks like from inside a
  // wait with no ceiling.
  //
  // THE WATCHDOG IS PART OF THE READING, not a separate assertion afterwards.
  // A first version checked for the Nudge button after the wait, which could
  // never fail: a stall failed the wait first, and a turn that recovered had
  // already cleared the Nudge by the time control arrived. Folded in here it
  // earns its place — the failure message says whether the board itself had
  // noticed, which is the difference between a slow turn and a wedged one.
  await expect
    .poll(async () => {
      if (await page.locator('button', { hasText: /^Nudge$/ }).count()) {
        return 'stalled — the board gave up and offered a Nudge'
      }
      return (await whoseTurn(page))?.toLowerCase() ?? ''
    }, {
      timeout: 90_000,
      message: 'the computer took its turn and never gave control back'
        + ' — the AI turn driver stalled mid-turn',
    })
    .toBe('harness')

  // AND THE HUMAN CAN ACT AGAIN. Control returning to a seat with nothing
  // pressable is the same soft-lock one step later.
  await expect(page.locator('button', { hasText: /✓ Confirm|Begin Attack|End Attack|End Turn/ }).first(),
    'control came back with no turn controls').toBeVisible()
})

test('several turns run through without the drivers wedging', async ({ page }) => {
  // ONE TURN REACHES NONE OF THE INTERRUPTS. No event card, no capture that
  // opens a modal, no elimination — and those are exactly where the AI driver
  // is least proven. It auto-answers its own choice modals and pauses for
  // human-owned ones, and a state it has no branch for is a wedge. Which of
  // them are covered is not a thing to reason about from the code; it is a
  // thing to walk into.
  //
  // EIGHTEEN HAND-OVERS — six rounds. Nine reached no interrupt at all, and
  // an event card or an elimination is what this is fishing for; a game that
  // ends inside the run is a legitimate finish and not a failure.
  // THREE SEATS, TWO OF THEM COMPUTERS, because two bots produce battles
  // between themselves as well as against the human — more captures, more
  // cards, more chances of an elimination inside the run.
  //
  // UNCAUGHT ERRORS ARE FAILURES HERE. An unhandled interrupt is at least as
  // likely to throw as to hang, and a throw inside a React effect leaves the
  // board looking fine while the driver is dead. Nothing else in this file
  // watches for that.
  const crashes: string[] = []
  page.on('pageerror', e => crashes.push(String(e)))

  await newCampaign(page, { others: ['Bot One', 'Bot Two'] })
  await startGame(page, { players: 3, ai: [1, 2] })
  await playSetup(page, 40, 'Harness')
  expect(await onBoard(page), 'never reached a board').toBe(true)

  const held = await playRounds(page, { you: 'Harness', turns: 18 })

  // SAID OUT LOUD, because the assertions below are SKIPPED when the game ends
  // early and a silently weakened test is the thing this file keeps catching
  // itself doing. A passing run should say how far it actually got.
  console.log(`turns held: ${held.join(' → ')}`
    + (await gameOver(page) ? ' (game ended inside the run)' : ''))

  // EVERY SEAT TOOK A TURN. Nine hand-overs across three players is three
  // rounds; a driver that quietly skipped a computer would show up as a name
  // missing from the log rather than as a hang.
  //
  // Unless the game ended early, which is a legitimate finish and not a fault
  // — a three-seat game can be over inside three rounds.
  if (!(await gameOver(page))) {
    expect(held.length, `only ${held.length} of 18 turns were played`).toBe(18)
    for (const who of ['Harness', 'Bot One', 'Bot Two']) {
      expect(held.some(h => h.toLowerCase() === who.toLowerCase()),
        `${who} never held a turn across ${held.join(' → ')}`).toBe(true)
    }
  }

  expect(crashes, `the page threw during play:\n${crashes.join('\n')}`).toEqual([])
})

test('an aged campaign plays through with its rare cards in the decks', async ({ page }) => {
  // WHAT THE PLAIN MULTI-TURN SPEC CANNOT REACH. Four runs of it — seventy-two
  // hand-overs over three seatings — turned up captures, card draws and failed
  // attacks, and not one event, mission, elimination or milestone. Not because
  // the driver handles them: because a GAME-ONE CAMPAIGN CANNOT REACH THEM.
  // GameBoard strips the base event cards outright and empties the mission deck
  // unless doubleWinnerMilestoneTriggered, so the rare half of the interrupt
  // matrix is gated behind campaign progress and replaying the first game walks
  // into none of it.
  //
  // So the campaign is aged first: missions back in play, the alien milestone
  // (which brings the Aliens faction, weakness powers, Die Humans and Beam
  // Down) and the nuclear one (missiles, the Fallout Zone, and the nuclear
  // milestone the AI driver pauses for). Then the same rounds are played.
  const crashes: string[] = []
  page.on('pageerror', e => crashes.push(String(e)))

  const world = await newCampaign(page, { others: ['Bot One', 'Bot Two'] })
  await ageCampaign(page, { missions: true, aliens: true, nuclear: true }, world)
  await startGame(page, { players: 3, ai: [1, 2] })
  await playSetup(page, 60, 'Harness')
  expect(await onBoard(page), 'an aged campaign never reached a board').toBe(true)

  // THE DECKS ARE ACTUALLY IN PLAY, asserted rather than assumed. Ageing that
  // silently failed would leave this spec identical to the one above it and
  // green for the wrong reason — which is the exact failure this file keeps
  // catching itself in.
  const opening = await page.locator('body').innerText()
  expect(/MISSION\n\s*★/.test(opening),
    'the mission deck is still empty — the campaign was not aged').toBe(true)

  const held = await playRounds(page, { you: 'Harness', turns: 18 })
  console.log(`aged turns held: ${held.join(' → ')}`
    + (await gameOver(page) ? ' (game ended inside the run)' : ''))

  if (!(await gameOver(page))) {
    expect(held.length, `only ${held.length} of 18 turns were played`).toBe(18)
  }
  expect(crashes, `the page threw during play:\n${crashes.join('\n')}`).toEqual([])
})
