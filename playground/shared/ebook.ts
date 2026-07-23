// Original content authored for this showcase. The prose is a calm
// field-notes/nature-observation novella written for the demo; it is not
// derived from any existing work. Chapters are intentionally long enough that
// several span pages, so the resolved page map (usePdfPageNumbers) is the only
// honest source for the Contents entries and the chapter-aware running footer.

export interface EbookChapter {
  // Anchor + bookmark id. Doubles as the internal-link target and the key the
  // resolved page map is looked up under, for the TOC and the running footer.
  id: string
  /** Oversized opener numeral (Lora, light tint) — the roman face of the ramp. */
  numeral: string
  title: string
  /** Quiet standfirst under the chapter title. */
  standfirst: string
  /** Body paragraphs. The first is opened with a small-caps lead-in. */
  paragraphs: string[]
}

export interface Ebook {
  title: string
  subtitle: string
  author: string
  imprint: string
  year: string
  /** Small, quiet colophon lines for the title verso. */
  colophon: string[]
  chapters: EbookChapter[]
}

export const sampleEbook: Ebook = {
  title: 'The Reed Line',
  subtitle: 'Field notes from a slow water',
  author: 'Wren Halloway',
  imprint: 'Nuxt PDF Editions',
  year: 'MMXXVI',
  colophon: [
    'Set in Lora and Inter, printed to a 5.5 by 8.5 inch digest page.',
    'The page numbers you see in the Contents and the running foot were not typed.',
    'They were measured — the layout runs until the printed numbers stop moving.',
    'Composed and rendered with Nuxt PDF from a single Vue component.',
    'First edition, one impression.',
  ],
  chapters: [
    {
      id: 'ch-reed-line',
      numeral: 'I',
      title: 'The Reed Line',
      standfirst: 'Where the field ends and the water is not yet sure of itself.',
      paragraphs: [
        'There is a line the reeds keep that no fence could hold to. It runs a hand’s width above the mud in dry weeks and drowns to the knee after rain, and the reeds move it without asking, closing over the shallows in a green so pale it reads almost grey at noon. I walked it for a year before I understood that the line was not the edge of the water. It was the water’s memory of where it had last been comfortable, and the reeds were only the handwriting.',
        'In the first cold mornings the stems are stiff with their own breath. Frost gathers on the seed heads and holds until the sun clears the alders on the far bank, and then the whole stand lets go at once, a small sound like a page turned in another room. I have learned to arrive before that hour. Everything the marsh intends to say for the day, it says in the ten minutes on either side of the frost letting go.',
        'The heron stands where the reeds thin. He is not patient, though everyone says so; patience implies he would rather be elsewhere. He is simply arranged, the way a sentence is arranged before it is spoken, and when the arrangement is complete a fish is already inside it. I have watched him for hours and never once seen the moment of the strike. The eye refuses it. There is a heron, and then there is a heron with a fish, and no bridge between the two that a person is allowed to cross.',
        'I keep my notes in pencil because ink runs when the fog settles on the page, and the fog settles most mornings. The pencil forgives the damp. It also forgives the hand that shakes a little in the cold, and it lets me cross out without pretending I never wrote the wrong thing. A field is not a clean place and a field notebook should not be a clean object. Mine has a tide line of its own, brown along the lower edge, where it has rested on wet stone more times than I can count.',
        'What I came to record was the birds. What I stayed to record was the reeds, because the birds only visit and the reeds live here, and the difference between a visitor and a resident turns out to be the whole of what a marsh is. The ducks arrive loud and leave louder. The reeds say nothing and outlast every argument. If you want to know a place, the tourists will tell you what is worth seeing. The reeds will tell you what is true.',
        'By the second month I had stopped counting individuals and started counting weather. It is a more honest census. A marsh does not hold a fixed number of anything; it holds a set of conditions, and the animals are the conditions made briefly visible. On a still grey day the surface is a slate someone forgot to wipe. On a windy one it is a field of small silver knives, each one turning, and the light comes off it in a way that makes the eye water and the heart, if you are not careful, do something similar.',
        'There is a plank across the drainage cut where the path would otherwise stop. Someone laid it before I came and someone will replace it after I go, and in between it is mine to trust twice a day. It has taught me more about faith than any building with a spire. You put your weight down before you know the plank will hold, because the only way to learn whether it holds is to have already trusted it. The marsh is full of small planks like this. So, I have come to think, is everything else.',
        'I do not name the animals. A named thing becomes a character, and a character has a story, and a story is a shape I would be pressing onto a creature that owes me nothing and means me nothing and is, for that reason, worth the whole of my attention. The heron is the heron. When he is gone I will not miss a friend. I will miss a fact, which is a cleaner grief and, I have found, a longer one.',
      ],
    },
    {
      id: 'ch-water-remembers',
      numeral: 'II',
      title: 'Water Remembers',
      standfirst: 'On the small archive a marsh keeps of every rain that ever fell.',
      paragraphs: [
        'Nothing here forgets a rain. The field to the west drinks and lets go within the day, but the marsh keeps every downpour for a week in the dark below the reeds, releasing it slowly into the cut, so that the water leaving on Friday fell on the Monday before. I used to think of the marsh as a place. It is closer to a clock, one that runs on weather instead of springs, and reads out the past week to anyone willing to kneel and put a hand into the cold to feel how fast it is still moving.',
        'The colour of the water tells the age of the rain. Fresh, it is the brown of strong tea, thick with whatever the field gave up as it drained. After three days it clears to the colour of weak cider, the sediment gone down, the tannins gone quiet. By the time it reaches the cut it is nearly the colour of nothing at all, and it is this nearly-nothing water, the oldest and most patient, that the fish prefer. They hold in it the way a reader holds in a long paragraph, unhurried, certain there is more.',
        'I lowered a jar on a string through the reed roots one August and brought up a history. Leaf from two autumns back, still whole, tanned to leather. A wren’s feather. A seed I could not name, swollen and refusing to sprout, waiting for a signal the dark could not give it. The marsh had filed each of these and forgotten none, and would go on holding them until some flood large enough to matter came to reshuffle the archive and start the slow filing over again.',
        'There is an art to reading a water level that no gauge can teach you. The reeds mark their high water in a faint bleaching, a tide line up the stem, and you can walk a whole season backward by reading those pale bands the way you read the rings of a felled tree. This one, ankle height, was the dry spell in June. That one, a hand above, was the week the culvert blocked and the whole eastern stand stood in its own reflection for nine days and came out darker for it, as standing water always leaves a thing darker than it found it.',
        'The old drainer who cut these channels a hundred years ago meant to be rid of the water. You can see his intention in the straightness of the cuts, ruled across the land as if the land were paper. But water has no respect for a ruled line, and within a decade the reeds had softened every edge he made, and now his straight channels curve, and his drained field is the wettest ground for a mile, and the marsh has quietly overwritten his entire argument without once raising its voice. I find this enormously consoling and I am not certain I should.',
        'On the coldest mornings the archive freezes at the surface and you can walk on the past week the way you might walk on a sheet of read pages. The ice is never trustworthy over the cut, where the old water is still moving underneath, and it is the moving water that keeps its own small window clear in the ice, a dark eye that never closes all winter, breathing faintly, reminding the frozen field above it that nothing here has actually stopped. It has only slowed to a speed the eye is finally able to follow.',
        'I have started to keep my notebook the way the marsh keeps its water: releasing nothing quickly, letting the day’s observations settle before I trust them to the page. The first thing you see is rarely the true thing. It is only the freshest thing, thick with whatever you brought to the looking. Wait three days, the way the water does, and what remains is clearer and older and worth the keeping. Most of what I wrote in my first month I have since drawn a quiet line through. The marsh taught me the patience to do it.',
        'What the water remembers, in the end, is not events but pressure. Not the storm but the weight of it, held and slowly let go. I think a person’s memory works the same, keeping less of what happened than of how hard it pressed, releasing it long after into the ordinary channels of a Tuesday, so that some grief you thought was finished arrives clear and cold and years late, and you kneel to it, and you feel how fast it is somehow still moving.',
      ],
    },
    {
      id: 'ch-weight-of-fog',
      numeral: 'III',
      title: 'The Weight of Fog',
      standfirst: 'A morning the marsh spent hidden, and what the hiding revealed.',
      paragraphs: [
        'Fog is the marsh breathing out. It comes on the mornings when the water is warmer than the air above it, which by autumn is most of them, and it stands the height of a person and no higher, so that from the low path you are inside it and from the ridge you look down on a white field with the alder crowns riding it like the masts of sunk ships. On such mornings I do not walk far. There is no point going to a place you cannot see. Better to stand still and let the place come to you a yard at a time.',
        'Sound changes weight in fog. The wren that would be a bright needle of noise in clear air becomes something felt more than heard, close and muffled and oddly kind. A dog barks on the far farm and arrives soft as a memory of a bark. The fog does to sound what still water does to sediment: it lets the sharp edges settle out, and what reaches you is the low rounded truth of a noise, its bones without its teeth. I have heard the marsh better on mornings I could not see it at all.',
        'The spiders are the ones who make the fog visible. Overnight they string the reed tops with a geometry too fine to notice, and then the fog lays a single bead of itself on every thread, and the whole invisible architecture of the night is suddenly declared, thousands of small wet drawings hung between the stems, holding for an hour until the sun burns through and takes back every bead and leaves the threads invisible again, still there, still working, simply no longer willing to be seen.',
        'I lost the plank once in the fog. I knew it to within a stride and still could not find it, and stood a foolish while at the lip of the cut with the cold running under the white, understanding for the first time that the path I trusted twice a day was a thing I had memorised, not a thing I could see, and that memory and sight are not the same faith and do not hold the same weight. The fog thinned. The plank was where it had always been. I crossed it more carefully than I had in a year.',
        'There is a particular grey that comes just before the fog gives up, a brightening without a source, the whole white field lighting evenly from nowhere the way a page lights when you carry it toward a window. In that grey the marsh has no distance and no direction. A reed at arm’s length and the far bank you cannot see occupy the same soft nothing, and for a few minutes the eye simply stops trying to measure and rests, and it is the only true rest the eye gets out here, where ordinarily there is always a far thing pulling it thin.',
        'The heron does not mind the fog. He is grey to begin with and the fog is only more of his own colour, and he fishes in it as well as in clear air, better perhaps, since the fish cannot see the sky he blots out. I have come around a stand of reeds and found him a stride away, both of us equally surprised, and in the fog even his going was quiet, a grey folding into grey, so that I could not have said the moment he ceased to be there any more than I can say the moment he takes a fish. The fog and the heron keep the same secrets.',
        'When it lifts, it lifts all at once, the way sleep lifts. One minute the white, the next a clean far bank and the alders standing in their proper places and the water flat and ordinary and pretending it never breathed at all. The beads are gone from the spider threads. The sound has its teeth back. And you are left with the plain lit marsh and a faint sense of having been somewhere else, somewhere with different rules, that closed behind you before you could write down the way back in.',
      ],
    },
    {
      id: 'ch-migrations',
      numeral: 'IV',
      title: 'Migrations',
      standfirst: 'The season the marsh fills and empties, and how it keeps the count.',
      paragraphs: [
        'They come down the sky in October the way water comes down the cut, in pulses, on their own weather. You hear them before the eye finds them, a high unravelling call passed back down a line you cannot yet see, and then the line resolves out of the grey, ragged, correcting itself, each bird holding a place it did not choose in an order no single bird understands. The marsh is a station on a route older than the drainer, older than the reeds perhaps, and for a few weeks it is busy the way a quiet town is busy on the one day the road remembers it.',
        'I do not count the flocks. You cannot; they will not hold still to be counted and they do not owe you a number. What I count is the days between the first line and the last, and it is a shrinking count, a day or two lost each year, the whole great movement arriving earlier and leaving sooner as the autumns soften. The marsh keeps this record without meaning to, in the trodden reeds and the fouled shallows and the sudden silence after, and I only copy out what it has already written on itself in a hand too large to read from close up.',
        'The first arrivals are the nervous ones, thin from the crossing, and they feed as if the light might be taken from them. By the second week the marsh is loud and settled and the birds argue over the good shallows with the confidence of the housed, and I sit on the ridge in the cold and listen to a town of them conducting its whole business at once, ten thousand small certainties none of which will still be here in a month, and I feel the particular loneliness of the resident watching the visitors, which is not envy exactly, but is not far from it.',
        'There is a night in every autumn when they all leave at once. You do not see it. You wake to a marsh gone quiet, the shallows empty, the reeds standing in a silence so total it has a pressure to it, and you know that in the dark, on a signal the water could not give the swollen seed and the sky somehow gives the birds, the whole town rose and went south and left the place to the reeds and the heron and the few of us who do not leave. The morning after is the emptiest of the year. It is also, I have come to think, the most honest.',
        'What stays teaches you more than what goes. The heron stays. The wren stays, impossibly, a thing the size of a thought holding its whole life against a winter that kills far larger animals, and it does this by wanting almost nothing and knowing exactly where that nothing is kept. The reeds stay, brown now, their green spent, holding the shape of the summer against the wind so that even in January you can read where the water was warmest by where the stand still stands. To stay is a skill. The marsh is a school of it and I am, at last, a slow pupil.',
        'I used to think the migration was the event and the winter the empty after. I have it backward now. The migration is the marsh briefly wearing a crowd, borrowing a noise that was always going to be returned. The winter is the marsh being what it is when nothing is borrowed, standing in its own cold water in its own brown reeds under its own low sky, keeping the count of everything that left by the exact shape of the space where it used to be. An empty place is not a place with nothing in it. It is a place with a shape of absence in it, and the shape is precise, and the marsh holds it all winter without once setting it down.',
        'On the last warm afternoon before the real cold I watched a single late bird come down the sky alone, off the route, weeks behind the rest, and settle in the empty shallows and call once into the silence and get no answer. It fed a while and slept and was gone by dawn, southward, alone, correcting a line it was the only member of. I wrote nothing that morning. Some things the notebook is too small a country to hold, and you leave them where they happened, in the reeds, in the cold, in the shape of the space where the flock used to be.',
      ],
    },
    {
      id: 'ch-ice-and-after',
      numeral: 'V',
      title: 'Ice and After',
      standfirst: 'The marsh closes over, and keeps, against every appearance, moving.',
      paragraphs: [
        'The ice comes from the edges in. First the still shallows behind the reeds, a skin so thin the first frost of it thaws by ten and the second holds till noon and the third does not thaw at all, and from there it works outward toward the cut, day by day, a white argument the water loses everywhere except over the moving channel, where it never quite closes, and keeps that one dark eye open on the whole frozen field like a sentence a book refuses to finish. I go out less now. The marsh has drawn in and does not want the company.',
        'Under the ice the water goes on with its filing, slower, the old rains still moving toward the cut, the leaf and the feather and the ungerminated seed all held now in a colder darker archive that will not be reshuffled until the thaw. I have knelt and put my ear to the ice over the channel and heard it, the faint continuous going of water that has not agreed to stop, and it is the most reassuring sound I know, more than any bird, because the birds are a summer’s promise and the water under the ice is a winter’s, and a winter’s promise is the only kind I have learned to trust.',
        'The reeds are the colour of old paper now and they rattle instead of whisper, dry stems knocking in the wind with a sound like the marsh reading itself back over, checking the year’s work before it files it. Some have gone down under the frost, laid flat in fans that mark the last strong wind, and the standing ones hold the low sun in a way the green ones never did, catching it along their length so that at four o’clock the whole dead stand burns a quiet gold for twenty minutes and then lets the light go and stands in the blue cold of the early dark, having asked for nothing, having kept everything.',
        'The heron is thinner and grimmer and still arranged. He fishes the dark eye over the channel where the fish are driven up under the ice to the one open water, and he takes them with the same invisible economy as in summer, a heron and then a heron with a fish, no bridge between, only now against the white the arrangement shows more plainly, a grey line of hunger written on a page gone finally, entirely blank. I do not name him still. But I look for him each morning, and on the mornings I do not find him I feel a cold that is not the weather’s.',
        'There is a false spring in February that fools the field but never the marsh. The field greens for a week and the marsh, wiser, older, keeper of the longer record, does not, and is proven right when the real cold comes back, and I have learned to trust the marsh’s judgement over my own hope, which greens as easily as any field and is wrong as often. The reeds wait. They have waited through worse and they keep waiting, and their waiting is not passive, is in fact the most active thing on the whole frozen marsh, a held readiness, a green kept coiled in the root under a foot of frozen water, staking the entire coming year on a warmth it cannot yet feel.',
        'And then, one unremarkable morning, the eye in the ice is wider. The next day wider still, and a smell comes off the opening water that has been absent so long you had forgotten it was a smell and not simply the way the world is, and you understand that the thaw has begun not with a crack or a flood but with a widening, the dark moving water reclaiming its field an inch a day from the one place it never surrendered. The reeds do not green for a month yet. But the marsh knows, and by the smell, at last, so do you.',
        'I have kept these notes for a year now, one full turn of the water, and the notebook has a tide line and a bend in it and pages I have drawn quiet lines through, and it holds less than I saw and more than I understood, which is the most any record can honestly hold. The marsh does not read it. The marsh keeps its own account, in the reeds and the ice and the shape of the space where the flock used to be, and its account is the true one, and mine is only the handwriting of a visitor who stayed long enough to be told a little, and is leaving now, and is grateful, and will not name what he is leaving, because it never once needed the name.',
      ],
    },
  ],
}

// A trimmed two-chapter cut for a fast scenario — proves the same machinery
// (multi-pass numbering, chapter-aware footer, outline) on a shorter book.
export const shortEbook: Ebook = {
  ...sampleEbook,
  title: 'The Reed Line',
  subtitle: 'Two chapters, one water',
  chapters: sampleEbook.chapters.slice(0, 2),
}

// Uppercase the first `count` words of a paragraph for the small-caps lead-in,
// returning the lead and the remainder so the SFC can render them inline.
export function splitLeadIn(paragraph: string, count = 4): { lead: string, rest: string } {
  const words = paragraph.split(' ')
  const lead = words.slice(0, count).join(' ')
  const rest = words.slice(count).join(' ')
  return { lead: lead.toUpperCase(), rest: rest ? ` ${rest}` : '' }
}
