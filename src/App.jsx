import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import * as d3 from "d3";
import { db, functions } from './firebase';
import { ref, set, get, update, remove, onValue, off, onDisconnect } from 'firebase/database';
import { httpsCallable } from 'firebase/functions';

/* ── Levenshtein distance for fuzzy matching ── */
function levenshtein(a,b){
  const m=a.length,n=b.length;
  const dp=Array.from({length:m+1},(_,i)=>Array.from({length:n+1},(_,j)=>i===0?j:j===0?i:0));
  for(let i=1;i<=m;i++)for(let j=1;j<=n;j++)dp[i][j]=a[i-1]===b[j-1]?dp[i-1][j-1]:1+Math.min(dp[i-1][j],dp[i][j-1],dp[i-1][j-1]);
  return dp[m][n];
}

/* ── TopoJSON Decoder ── */
function decodeTopo(topology, name) {
  const obj = topology.objects[name], arcs = topology.arcs, tf = topology.transform;
  function decArc(i) {
    const a = arcs[i < 0 ? ~i : i]; const c = []; let x=0,y=0;
    for (const [dx,dy] of a){x+=dx;y+=dy;c.push([tf.scale[0]*x+tf.translate[0],tf.scale[1]*y+tf.translate[1]]);}
    if(i<0)c.reverse(); return c;
  }
  const ring = ids => { const c=[]; for(const i of ids){const a=decArc(i);c.push(...(c.length?a.slice(1):a));}return c; };
  const geom = g => {
    if(g.type==="Polygon") return {type:"Polygon",coordinates:g.arcs.map(ring)};
    if(g.type==="MultiPolygon") return {type:"MultiPolygon",coordinates:g.arcs.map(p=>p.map(ring))};
    return g;
  };
  return {type:"FeatureCollection",features:obj.geometries.map(g=>({type:"Feature",id:String(g.id),properties:g.properties||{},geometry:geom(g)}))};
}

/* ── 197 Countries ── */
const ID_NAME={"004":"Afghanistan","008":"Albania","012":"Algeria","020":"Andorra","024":"Angola","028":"Antigua and Barbuda","032":"Argentina","051":"Armenia","036":"Australia","040":"Austria","031":"Azerbaijan","044":"Bahamas","048":"Bahrain","050":"Bangladesh","052":"Barbados","112":"Belarus","056":"Belgium","084":"Belize","204":"Benin","064":"Bhutan","068":"Bolivia","070":"Bosnia and Herzegovina","072":"Botswana","076":"Brazil","096":"Brunei","100":"Bulgaria","854":"Burkina Faso","108":"Burundi","132":"Cape Verde","116":"Cambodia","120":"Cameroon","124":"Canada","140":"Central African Republic","148":"Chad","152":"Chile","156":"China","170":"Colombia","174":"Comoros","178":"Republic of the Congo","180":"Democratic Republic of the Congo","188":"Costa Rica","384":"Ivory Coast","191":"Croatia","192":"Cuba","196":"Cyprus","203":"Czech Republic","208":"Denmark","262":"Djibouti","212":"Dominica","214":"Dominican Republic","218":"Ecuador","818":"Egypt","222":"El Salvador","226":"Equatorial Guinea","232":"Eritrea","233":"Estonia","748":"Eswatini","231":"Ethiopia","242":"Fiji","246":"Finland","250":"France","266":"Gabon","270":"Gambia","268":"Georgia","276":"Germany","288":"Ghana","300":"Greece","308":"Grenada","320":"Guatemala","324":"Guinea","624":"Guinea-Bissau","328":"Guyana","332":"Haiti","340":"Honduras","348":"Hungary","352":"Iceland","356":"India","360":"Indonesia","364":"Iran","368":"Iraq","372":"Ireland","376":"Israel","380":"Italy","388":"Jamaica","392":"Japan","400":"Jordan","398":"Kazakhstan","404":"Kenya","296":"Kiribati","408":"North Korea","410":"South Korea","414":"Kuwait","417":"Kyrgyzstan","418":"Laos","428":"Latvia","422":"Lebanon","426":"Lesotho","430":"Liberia","434":"Libya","438":"Liechtenstein","440":"Lithuania","442":"Luxembourg","450":"Madagascar","454":"Malawi","458":"Malaysia","462":"Maldives","466":"Mali","470":"Malta","584":"Marshall Islands","478":"Mauritania","480":"Mauritius","484":"Mexico","583":"Micronesia","498":"Moldova","492":"Monaco","496":"Mongolia","499":"Montenegro","504":"Morocco","508":"Mozambique","104":"Myanmar","516":"Namibia","520":"Nauru","524":"Nepal","528":"Netherlands","554":"New Zealand","558":"Nicaragua","562":"Niger","566":"Nigeria","807":"North Macedonia","578":"Norway","512":"Oman","586":"Pakistan","585":"Palau","275":"Palestine","591":"Panama","598":"Papua New Guinea","600":"Paraguay","604":"Peru","608":"Philippines","616":"Poland","620":"Portugal","634":"Qatar","642":"Romania","643":"Russia","646":"Rwanda","659":"Saint Kitts and Nevis","662":"Saint Lucia","670":"Saint Vincent and the Grenadines","882":"Samoa","674":"San Marino","678":"Sao Tome and Principe","682":"Saudi Arabia","686":"Senegal","688":"Serbia","690":"Seychelles","694":"Sierra Leone","702":"Singapore","703":"Slovakia","705":"Slovenia","090":"Solomon Islands","706":"Somalia","710":"South Africa","728":"South Sudan","724":"Spain","144":"Sri Lanka","729":"Sudan","740":"Suriname","752":"Sweden","756":"Switzerland","760":"Syria","158":"Taiwan","762":"Tajikistan","834":"Tanzania","764":"Thailand","626":"Timor-Leste","768":"Togo","776":"Tonga","780":"Trinidad and Tobago","788":"Tunisia","792":"Turkey","795":"Turkmenistan","798":"Tuvalu","800":"Uganda","804":"Ukraine","784":"United Arab Emirates","826":"United Kingdom","840":"United States of America","858":"Uruguay","860":"Uzbekistan","548":"Vanuatu","336":"Vatican City","862":"Venezuela","704":"Vietnam","887":"Yemen","894":"Zambia","716":"Zimbabwe","383":"Kosovo"};
const TOTAL=Object.keys(ID_NAME).length;

const SMALL={"020":[42.51,1.52],"028":[17.06,-61.8],"044":[25.03,-77.4],"048":[26.07,50.55],"052":[13.19,-59.54],"084":[17.19,-88.5],"132":[16,-24],"174":[-12.17,44.25],"212":[15.41,-61.37],"296":[1.87,-157.36],"308":[12.12,-61.67],"336":[41.9,12.45],"438":[47.17,9.55],"462":[3.2,73.22],"470":[35.9,14.5],"480":[-20.35,57.55],"492":[43.73,7.42],"520":[-0.52,166.93],"583":[7.43,150.55],"584":[7.09,171.38],"585":[7.51,134.58],"626":[-8.87,125.73],"659":[17.34,-62.77],"662":[13.91,-60.98],"670":[13.25,-61.2],"674":[43.94,12.46],"678":[0.19,6.61],"690":[-4.68,55.49],"702":[1.35,103.82],"776":[-21.18,-175.2],"798":[-7.11,177.65],"882":[-13.76,-172.1],"090":[-9.43,160.02],"548":[-17.73,168.32],"275":[31.95,35.23],"383":[42.6,20.9]};

const ALIASES={"us":"United States of America","usa":"United States of America","united states":"United States of America","america":"United States of America","uk":"United Kingdom","britain":"United Kingdom","great britain":"United Kingdom","england":"United Kingdom","uae":"United Arab Emirates","emirates":"United Arab Emirates","south korea":"South Korea","korea":"South Korea","north korea":"North Korea","drc":"Democratic Republic of the Congo","congo":"Republic of the Congo","dr congo":"Democratic Republic of the Congo","czechia":"Czech Republic","cote d'ivoire":"Ivory Coast","cote divoire":"Ivory Coast","burma":"Myanmar","holland":"Netherlands","swaziland":"Eswatini","macedonia":"North Macedonia","east timor":"Timor-Leste","persia":"Iran","siam":"Thailand","brasil":"Brazil","turkiye":"Turkey","cabo verde":"Cape Verde","vatican":"Vatican City","holy see":"Vatican City","st kitts":"Saint Kitts and Nevis","st lucia":"Saint Lucia","st vincent":"Saint Vincent and the Grenadines","sao tome":"Sao Tome and Principe","ivory coast":"Ivory Coast","the bahamas":"Bahamas","the gambia":"Gambia","brunei darussalam":"Brunei","lao pdr":"Laos","russian federation":"Russia","republic of korea":"South Korea","car":"Central African Republic","png":"Papua New Guinea","nz":"New Zealand","the netherlands":"Netherlands","trinidad":"Trinidad and Tobago","bosnia":"Bosnia and Herzegovina","dominican rep":"Dominican Republic","solomon islands":"Solomon Islands","marshall islands":"Marshall Islands","timor leste":"Timor-Leste","palestine":"Palestine","west bank":"Palestine"};

/* ── Territories & Dependencies — not counted in 197 but discoverable ── */
const TERRITORIES={
  "puerto rico":{name:"Puerto Rico",parent:"United States of America",lat:18.22,lng:-66.59,iso:"630",fact:"An unincorporated US territory since 1898. Its residents are US citizens but cannot vote in presidential elections."},
  "guam":{name:"Guam",parent:"United States of America",lat:13.44,lng:144.79,iso:"316",fact:"A US territory in the western Pacific, home to major military bases. Chamorro is the indigenous language."},
  "us virgin islands":{name:"US Virgin Islands",parent:"United States of America",lat:18.34,lng:-64.93,fact:"Purchased from Denmark in 1917. Made up of St. Thomas, St. John, and St. Croix."},
  "american samoa":{name:"American Samoa",parent:"United States of America",lat:-14.27,lng:-170.7,iso:"016",fact:"The only US territory south of the equator. Residents are US nationals, not citizens by birth."},
  "northern mariana islands":{name:"Northern Mariana Islands",parent:"United States of America",lat:15.18,lng:145.75,iso:"580",fact:"A chain of 14 islands in the Pacific. Became a US commonwealth in 1978."},
  "greenland":{name:"Greenland",parent:"Denmark",lat:71.71,lng:-42.6,iso:"304",fact:"The world's largest island, an autonomous territory of Denmark. Over 80% is covered by an ice sheet."},
  "hong kong":{name:"Hong Kong",parent:"China",lat:22.32,lng:114.17,iso:"344",fact:"A Special Administrative Region of China operating under 'one country, two systems' until 2047."},
  "macau":{name:"Macau",parent:"China",lat:22.2,lng:113.55,fact:"A former Portuguese colony, now a Chinese SAR. It's the most densely populated region in the world."},
  "french guiana":{name:"French Guiana",parent:"France",lat:3.93,lng:-53.13,iso:"254",fact:"An overseas department of France in South America. The European Space Agency launches rockets from Kourou."},
  "french polynesia":{name:"French Polynesia",parent:"France",lat:-17.68,lng:-149.41,iso:"258",fact:"A collection of 118 islands including Tahiti and Bora Bora. It spans an area the size of Western Europe."},
  "new caledonia":{name:"New Caledonia",parent:"France",lat:-22.26,lng:166.46,iso:"540",fact:"A French territory in the Pacific with the world's largest lagoon. It holds about 25% of global nickel reserves."},
  "reunion":{name:"Réunion",parent:"France",lat:-21.12,lng:55.54,fact:"A French overseas department in the Indian Ocean near Madagascar. Home to one of the world's most active volcanoes."},
  "bermuda":{name:"Bermuda",parent:"United Kingdom",lat:32.32,lng:-64.76,fact:"A British Overseas Territory in the North Atlantic. It has the oldest English-speaking parliament outside the UK."},
  "cayman islands":{name:"Cayman Islands",parent:"United Kingdom",lat:19.31,lng:-81.25,iso:"136",fact:"A British territory and major global financial center. More companies are registered here than people living on the islands."},
  "gibraltar":{name:"Gibraltar",parent:"United Kingdom",lat:36.14,lng:-5.35,fact:"A British Overseas Territory at the tip of the Iberian Peninsula. The famous Rock of Gibraltar is 426 meters tall."},
  "falkland islands":{name:"Falkland Islands",parent:"United Kingdom",lat:-51.8,lng:-59.0,iso:"238",fact:"A British territory in the South Atlantic. The 1982 Falklands War between the UK and Argentina lasted 74 days."},
  "turks and caicos":{name:"Turks and Caicos",parent:"United Kingdom",lat:21.79,lng:-72.17,iso:"796",fact:"A British territory in the Caribbean with 40 islands. Only 8 are inhabited."},
  "british virgin islands":{name:"British Virgin Islands",parent:"United Kingdom",lat:18.42,lng:-64.64,fact:"Comprising around 60 islands in the Caribbean. Tourism and financial services drive the economy."},
  "aruba":{name:"Aruba",parent:"Netherlands",lat:12.51,lng:-69.97,iso:"533",fact:"A constituent country of the Netherlands in the Caribbean. Its economy is heavily dependent on tourism."},
  "curacao":{name:"Curaçao",parent:"Netherlands",lat:12.17,lng:-68.98,iso:"531",fact:"A Dutch Caribbean island known for its colorful colonial architecture in Willemstad, a UNESCO World Heritage Site."},
  "sint maarten":{name:"Sint Maarten",parent:"Netherlands",lat:18.04,lng:-63.05,fact:"The smallest inhabited island shared by two nations — the Dutch south and French north (Saint-Martin)."},
  "western sahara":{name:"Western Sahara",parent:"Morocco (disputed)",lat:24.22,lng:-12.89,iso:"732",fact:"A disputed territory in North Africa. Morocco controls most of it, while the Polisario Front seeks independence."},
  "cook islands":{name:"Cook Islands",parent:"New Zealand",lat:-21.24,lng:-159.78,iso:"184",fact:"A self-governing territory in free association with New Zealand. Made up of 15 islands spread over 2 million km² of ocean."},
  "niue":{name:"Niue",parent:"New Zealand",lat:-19.05,lng:-169.87,fact:"One of the world's smallest self-governing states in free association with New Zealand. Population: about 1,600."},
  "tokelau":{name:"Tokelau",parent:"New Zealand",lat:-9.2,lng:-171.85,fact:"A New Zealand territory of three atolls in the Pacific. It was the first territory in the world to be 100% solar-powered."},
  "faroe islands":{name:"Faroe Islands",parent:"Denmark",lat:62.01,lng:-6.77,iso:"234",fact:"A self-governing Danish territory of 18 rocky islands between Norway and Iceland. Famous for bird cliffs and sheep."},
  "isle of man":{name:"Isle of Man",parent:"United Kingdom",lat:54.24,lng:-4.55,fact:"A British Crown dependency in the Irish Sea. Home to the famous TT motorcycle race and the world's oldest continuous parliament (Tynwald)."},
  "jersey":{name:"Jersey",parent:"United Kingdom",lat:49.21,lng:-2.13,fact:"The largest Channel Island and a Crown dependency. It has its own financial and legal systems separate from the UK."},
  "guernsey":{name:"Guernsey",parent:"United Kingdom",lat:49.45,lng:-2.54,fact:"A Channel Island Crown dependency known for its financial services sector and the Guernsey cow breed."},
  "norfolk island":{name:"Norfolk Island",parent:"Australia",lat:-29.04,lng:167.95,fact:"An Australian territory settled by descendants of the HMS Bounty mutineers from Pitcairn Island in 1856."},
  "christmas island":{name:"Christmas Island",parent:"Australia",lat:-10.49,lng:105.63,fact:"An Australian territory in the Indian Ocean, famous for its annual red crab migration of over 50 million crabs."},
  "pitcairn islands":{name:"Pitcairn Islands",parent:"United Kingdom",lat:-25.07,lng:-130.1,fact:"The least populous national jurisdiction in the world with about 50 residents, descendants of the Bounty mutineers."}
};
/* Alias lookups for territories */
const TERR_ALIASES={"bvi":"british virgin islands","usvi":"us virgin islands","vi":"us virgin islands","st martin":"sint maarten","saint martin":"sint maarten","st maarten":"sint maarten","hk":"hong kong","macao":"macau","falklands":"falkland islands","malvinas":"falkland islands","tci":"turks and caicos","cnmi":"northern mariana islands"};
const TERR_TOTAL=Object.keys(TERRITORIES).length;

/* Country facts for "fact" hint type */
const COUNTRY_FACTS={"004":"This landlocked Asian nation has the Hindu Kush mountain range","008":"This small Balkan country borders the Adriatic Sea","012":"The largest country in Africa by area","020":"One of the smallest countries in Europe, nestled between France and Spain","024":"This southwestern African nation was once a Portuguese colony","028":"This Caribbean twin-island nation is one of the smallest in the Americas","032":"Home to the tango, the Pampas, and Patagonia","051":"This Caucasus nation was the first country to adopt Christianity","036":"The world's smallest continent and largest island country","040":"Famous for Mozart, the Alps, and Viennese coffee culture","031":"A Caucasus nation where mud volcanoes outnumber all other countries","044":"This Caribbean archipelago is known for swimming pigs","048":"This tiny island kingdom in the Persian Gulf is connected to Saudi Arabia by a bridge","050":"One of the most densely populated countries, in South Asia","052":"This Caribbean island is known for rum and flying fish","112":"This Eastern European landlocked nation borders Russia and Poland","056":"Known for chocolate, waffles, and hosting EU headquarters","084":"This Central American country has the world's second-largest barrier reef","204":"This West African country was once the seat of the Kingdom of Dahomey","064":"This Himalayan kingdom measures national happiness instead of GDP","068":"This landlocked South American nation has the world's highest capital","070":"This Balkan country's capital hosted the 1984 Winter Olympics","072":"Home to the Okavango Delta, one of the world's largest inland deltas","076":"The largest country in South America, known for the Amazon","096":"This small Southeast Asian nation on Borneo is one of the world's richest","100":"This Balkan country is famous for rose oil production","854":"This landlocked West African nation was once called Upper Volta","108":"One of the smallest and most densely populated African countries","132":"This volcanic Atlantic archipelago off West Africa was uninhabited until the 15th century","116":"Home to Angkor Wat, the world's largest religious monument","120":"This Central African country is sometimes called Africa in miniature","124":"The second-largest country by area, known for maple syrup","140":"This landlocked Central African nation is one of the least developed countries","148":"This landlocked Saharan country is home to the Ennedi Plateau","152":"The world's longest north-to-south country in South America","156":"The world's most populous country, home to the Great Wall","170":"The only South American country with both Pacific and Caribbean coasts","174":"This volcanic archipelago in the Indian Ocean is known as the perfume islands","178":"This Central African nation straddles the equator along the Congo River","180":"This Central African country has the world's second-largest rainforest","188":"This Central American country has no military, abolished in 1948","384":"The world's largest cocoa producer, in West Africa","191":"This Adriatic country has over 1,000 islands","192":"This Caribbean island nation is the largest in the West Indies","196":"This Mediterranean island nation is divided between two communities","203":"This Central European country is known for its beer, castles, and crystal","208":"This Scandinavian kingdom includes Greenland as a territory","262":"This small Horn of Africa nation hosts multiple foreign military bases","212":"This tiny Caribbean island is known as the Nature Island","214":"This Caribbean nation shares the island of Hispaniola with Haiti","218":"This South American country is named after the equator","818":"Home to the Nile, pyramids, and the Suez Canal","222":"The smallest and most densely populated country in Central America","226":"The only Spanish-speaking country in Central Africa","232":"This Horn of Africa nation won independence from Ethiopia in 1993","233":"This Baltic state is one of the most digitally advanced countries in the world","748":"Africa's last absolute monarchy, recently renamed from Swaziland","231":"This ancient African civilization has its own calendar and unique alphabet","242":"This South Pacific island nation is known for its fire-walking ceremonies","246":"Known for saunas, the Northern Lights, and being the happiest country","250":"This Western European country is known for the Eiffel Tower and wine","266":"This equatorial African country is 85% covered by rainforest","270":"The smallest country on mainland Africa","268":"This Caucasus nation is the birthplace of wine, with 8,000 years of winemaking","276":"Europe's largest economy, known for engineering and Oktoberfest","288":"This West African country was the first sub-Saharan nation to gain independence","300":"The birthplace of democracy and the Olympic Games","308":"Known as the Spice Island of the Caribbean","320":"This Central American country was the heart of the ancient Maya civilization","324":"This West African country has some of the world's largest bauxite reserves","624":"This small West African country is one of the world's least developed nations","328":"This South American country is the only English-speaking nation on the continent","332":"This Caribbean nation became the world's first Black-led republic in 1804","340":"This Central American country is named after its deep coastal waters","348":"This Central European country is famous for thermal baths and goulash","352":"This Nordic island nation sits on the Mid-Atlantic Ridge","356":"The world's largest democracy, home to the Taj Mahal","360":"The world's largest archipelago with over 17,000 islands","364":"Formerly known as Persia, this Middle Eastern country borders the Caspian Sea","368":"This Middle Eastern country sits between the Tigris and Euphrates rivers","372":"Known as the Emerald Isle, famous for its green landscapes","376":"This Middle Eastern country is home to the Dead Sea, the lowest point on Earth","380":"Shaped like a boot, this country has the most UNESCO World Heritage Sites","388":"This Caribbean island is known for reggae music and Blue Mountain Coffee","392":"An island nation known for cherry blossoms and Mount Fuji","400":"This Middle Eastern kingdom contains the ancient city of Petra","398":"The world's largest landlocked country, spanning Central Asia","404":"Famous for safaris, the Great Rift Valley, and long-distance runners","296":"This Pacific nation straddles the equator and the International Date Line","408":"One of the most isolated countries, occupying the northern half of its peninsula","410":"Known for K-pop, kimchi, and rapid technological advancement","414":"This small oil-rich Persian Gulf state was liberated in 1991","417":"This mountainous Central Asian country is 90% covered by mountains","418":"This landlocked Southeast Asian nation has the most unexploded bombs per capita","428":"This Baltic state has one of the fastest internet speeds in the world","422":"This tiny Mediterranean country has more people abroad than at home","426":"This mountainous African kingdom is entirely surrounded by South Africa","430":"This West African nation was founded by freed American slaves in 1847","434":"This North African country has Africa's largest proven oil reserves","438":"This tiny Alpine principality between Austria and Switzerland is doubly landlocked","440":"This Baltic state has the geographic center of Europe","442":"One of the smallest and wealthiest countries in Europe","450":"This island nation off Africa's coast has wildlife found nowhere else on Earth","454":"This landlocked southeast African country is home to Lake Malawi","458":"This Southeast Asian country is split between a peninsula and Borneo","462":"This Indian Ocean archipelago is the lowest-lying country, barely above sea level","466":"This West African country is home to the legendary city of Timbuktu","470":"This tiny Mediterranean island was once ruled by the Knights of St. John","478":"This West African country bridges Arab and sub-Saharan Africa","480":"This Indian Ocean island is known for its dodo bird heritage","484":"North America's most populous Spanish-speaking nation","583":"This Pacific nation consists of over 600 islands across 1,700 miles of ocean","498":"This Eastern European country is landlocked between Romania and Ukraine","492":"This tiny city-state on the French Riviera is the most densely populated country","496":"This vast landlocked country between Russia and China has the least dense population","499":"This small Balkan country has a stunning Adriatic coastline","504":"This North African kingdom is home to the Atlas Mountains","508":"This southeast African country has one of the longest coastlines in Africa","104":"This Southeast Asian country was formerly known as Burma","516":"This southern African country has one of the lowest population densities","520":"The world's smallest island nation and the least visited country","524":"This South Asian country is home to eight of the world's ten tallest mountains","528":"This low-lying European country is famous for windmills and tulips","554":"This Oceanian country has more sheep than people","558":"This Central American country has the largest area in the region","562":"This landlocked Saharan country is named after the Niger River","566":"Africa's most populous country, sometimes called the Giant of Africa","807":"This Balkan country changed its name in 2019 to settle a dispute with Greece","578":"This Scandinavian kingdom is famous for fjords and the Northern Lights","512":"This Arabian Peninsula country is known for its dramatic mountain fortresses","586":"This South Asian country was created in 1947 during partition","585":"This tiny Pacific island nation has the world's highest percentage of WWII shipwrecks","591":"This Central American country connects North and South America with a famous canal","598":"This Oceanian country has over 800 languages, the most of any nation","600":"This landlocked South American country has the world's largest freshwater naval force","604":"Home to Machu Picchu and the ancient Inca Empire","608":"An archipelago of over 7,000 islands in Southeast Asia","616":"This Central European country is home to Copernicus and Chopin","620":"The westernmost country in continental Europe","634":"This tiny Persian Gulf peninsula will host the 2022 FIFA World Cup","642":"This Eastern European country's name means 'Land of Romans'","643":"The largest country in the world by area, spanning 11 time zones","646":"Known as the land of a thousand hills, in East Africa","682":"Home to Mecca and Medina, the two holiest cities in Islam","686":"This West African country is the westernmost point of continental Africa","688":"This Balkan country was the largest republic of former Yugoslavia","694":"This West African country's name means Mountain Lion in Portuguese","702":"This tiny city-state is one of only three surviving city-states in the world","703":"This Central European country split from Czechia peacefully in 1993","705":"This small Alpine country has a coastline of only 46 kilometers","706":"Located on the Horn of Africa, this country has the longest coastline on the continent","710":"This nation at Africa's southern tip has three capital cities","728":"The world's newest country, gaining independence in 2011","724":"Known for flamenco, tapas, and the Running of the Bulls","144":"This island nation off India's coast was formerly known as Ceylon","729":"This North African country is where the Blue and White Nile merge","740":"The smallest country in South America","752":"This Scandinavian country is known for IKEA and ABBA","756":"A landlocked Alpine country famous for neutrality and banking","760":"This ancient Middle Eastern country is home to one of the oldest continuously inhabited cities","158":"This island produces most of the world's advanced semiconductors","762":"This mountainous Central Asian country has more than half its territory above 3,000 meters","834":"This East African country is home to Mount Kilimanjaro and the Serengeti","764":"Formerly known as Siam, famous for its temples and cuisine","626":"This Southeast Asian half-island nation is one of the world's newest countries","768":"This narrow West African country is only 115 km wide at its widest","780":"This Caribbean twin-island nation is known for Carnival and steel pan music","788":"This North African country has ruins of ancient Carthage","792":"A transcontinental country straddling Europe and Asia","795":"This Central Asian country has the world's fourth-largest natural gas reserves","800":"This East African country is home to half of the world's mountain gorillas","804":"The largest country entirely within Europe","784":"This federation of seven emirates is home to the world's tallest building","826":"An island nation that once ruled the largest empire in history","840":"The world's third-largest country, known as the land of opportunity","858":"This South American country has been called the Switzerland of South America","860":"This doubly landlocked Central Asian country has ancient Silk Road cities","862":"This South American country has the world's largest oil reserves","704":"This Southeast Asian country is shaped like the letter S","887":"This Arabian Peninsula country was once home to the ancient Kingdom of Sheba","894":"This southern African country is home to Victoria Falls","716":"This southern African country has ancient stone ruins that gave it its name","383":"This Balkan territory declared independence from Serbia in 2008","275":"This Middle Eastern territory along the Mediterranean has been at the center of one of the world's longest conflicts","336":"The world's smallest country by area, entirely within Rome, headquarters of the Catholic Church","548":"This South Pacific archipelago is famous for land diving, the precursor to bungee jumping","584":"This Pacific nation of coral atolls was a US nuclear testing site during the Cold War","659":"This Caribbean two-island nation is the smallest sovereign state in the Americas","662":"This volcanic Caribbean island is named after Saint Lucy of Syracuse","670":"This Caribbean island chain is known as the Jewels of the Caribbean","674":"One of the world's oldest republics, founded in 301 AD, surrounded entirely by Italy","678":"This tiny equatorial African island nation in the Gulf of Guinea is one of Africa's smallest","690":"This Indian Ocean archipelago of 115 islands has the smallest population of any African sovereign state","776":"This Polynesian kingdom is the only remaining monarchy in the Pacific","798":"This tiny Pacific nation is the fourth-smallest country and faces existential threat from rising seas","882":"This Polynesian nation was the first Pacific island country to gain independence in the 20th century","090":"This Melanesian archipelago in the South Pacific saw fierce WWII battles including Guadalcanal"};

const W=960,H=500;

/* ISO numeric → alpha-2 for flag emojis */
const ID_A2={"004":"AF","008":"AL","012":"DZ","020":"AD","024":"AO","028":"AG","032":"AR","051":"AM","036":"AU","040":"AT","031":"AZ","044":"BS","048":"BH","050":"BD","052":"BB","112":"BY","056":"BE","084":"BZ","204":"BJ","064":"BT","068":"BO","070":"BA","072":"BW","076":"BR","096":"BN","100":"BG","854":"BF","108":"BI","132":"CV","116":"KH","120":"CM","124":"CA","140":"CF","148":"TD","152":"CL","156":"CN","170":"CO","174":"KM","178":"CG","180":"CD","188":"CR","384":"CI","191":"HR","192":"CU","196":"CY","203":"CZ","208":"DK","262":"DJ","212":"DM","214":"DO","218":"EC","818":"EG","222":"SV","226":"GQ","232":"ER","233":"EE","748":"SZ","231":"ET","242":"FJ","246":"FI","250":"FR","266":"GA","270":"GM","268":"GE","276":"DE","288":"GH","300":"GR","308":"GD","320":"GT","324":"GN","624":"GW","328":"GY","332":"HT","340":"HN","348":"HU","352":"IS","356":"IN","360":"ID","364":"IR","368":"IQ","372":"IE","376":"IL","380":"IT","388":"JM","392":"JP","400":"JO","398":"KZ","404":"KE","296":"KI","408":"KP","410":"KR","414":"KW","417":"KG","418":"LA","428":"LV","422":"LB","426":"LS","430":"LR","434":"LY","438":"LI","440":"LT","442":"LU","450":"MG","454":"MW","458":"MY","462":"MV","466":"ML","470":"MT","584":"MH","478":"MR","480":"MU","484":"MX","583":"FM","498":"MD","492":"MC","496":"MN","499":"ME","504":"MA","508":"MZ","104":"MM","516":"NA","520":"NR","524":"NP","528":"NL","554":"NZ","558":"NI","562":"NE","566":"NG","807":"MK","578":"NO","512":"OM","586":"PK","585":"PW","275":"PS","591":"PA","598":"PG","600":"PY","604":"PE","608":"PH","616":"PL","620":"PT","634":"QA","642":"RO","643":"RU","646":"RW","659":"KN","662":"LC","670":"VC","882":"WS","674":"SM","678":"ST","682":"SA","686":"SN","688":"RS","690":"SC","694":"SL","702":"SG","703":"SK","705":"SI","090":"SB","706":"SO","710":"ZA","728":"SS","724":"ES","144":"LK","729":"SD","740":"SR","752":"SE","756":"CH","760":"SY","158":"TW","762":"TJ","834":"TZ","764":"TH","626":"TL","768":"TG","776":"TO","780":"TT","788":"TN","792":"TR","795":"TM","798":"TV","800":"UG","804":"UA","784":"AE","826":"GB","840":"US","858":"UY","860":"UZ","548":"VU","336":"VA","862":"VE","704":"VN","887":"YE","894":"ZM","716":"ZW","383":"XK"};
function getFlag(id){const a2=ID_A2[id];if(!a2)return"";return String.fromCodePoint(...[...a2].map(c=>0x1F1E6+c.charCodeAt(0)-65));}

function genCode(){const c='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';return Array.from({length:6},()=>c[Math.floor(Math.random()*c.length)]).join('');}

/* ── Continent mapping ── */
const ID_CONTINENT={
  // Africa
  "012":"Africa","024":"Africa","204":"Africa","072":"Africa","854":"Africa","108":"Africa","132":"Africa","120":"Africa","140":"Africa","148":"Africa","174":"Africa","178":"Africa","180":"Africa","262":"Africa","818":"Africa","226":"Africa","232":"Africa","748":"Africa","231":"Africa","266":"Africa","270":"Africa","288":"Africa","324":"Africa","624":"Africa","384":"Africa","404":"Africa","426":"Africa","430":"Africa","434":"Africa","450":"Africa","454":"Africa","466":"Africa","478":"Africa","480":"Africa","504":"Africa","508":"Africa","516":"Africa","562":"Africa","566":"Africa","646":"Africa","678":"Africa","686":"Africa","690":"Africa","694":"Africa","706":"Africa","710":"Africa","728":"Africa","729":"Africa","834":"Africa","768":"Africa","788":"Africa","800":"Africa","894":"Africa","716":"Africa",
  // Asia
  "004":"Asia","051":"Asia","031":"Asia","048":"Asia","050":"Asia","064":"Asia","096":"Asia","116":"Asia","156":"Asia","268":"Asia","356":"Asia","360":"Asia","364":"Asia","368":"Asia","376":"Asia","392":"Asia","400":"Asia","398":"Asia","414":"Asia","417":"Asia","418":"Asia","422":"Asia","458":"Asia","462":"Asia","104":"Asia","496":"Asia","524":"Asia","408":"Asia","512":"Asia","586":"Asia","275":"Asia","608":"Asia","634":"Asia","682":"Asia","702":"Asia","410":"Asia","144":"Asia","760":"Asia","158":"Asia","762":"Asia","764":"Asia","626":"Asia","792":"Asia","795":"Asia","784":"Asia","860":"Asia","704":"Asia","887":"Asia",
  // Europe
  "008":"Europe","020":"Europe","040":"Europe","112":"Europe","056":"Europe","070":"Europe","100":"Europe","191":"Europe","196":"Europe","203":"Europe","208":"Europe","233":"Europe","246":"Europe","250":"Europe","276":"Europe","300":"Europe","348":"Europe","352":"Europe","372":"Europe","380":"Europe","383":"Europe","428":"Europe","438":"Europe","440":"Europe","442":"Europe","470":"Europe","498":"Europe","492":"Europe","499":"Europe","528":"Europe","807":"Europe","578":"Europe","616":"Europe","620":"Europe","642":"Europe","643":"Europe","674":"Europe","688":"Europe","703":"Europe","705":"Europe","724":"Europe","752":"Europe","756":"Europe","804":"Europe","826":"Europe","336":"Europe",
  // North America
  "028":"North America","044":"North America","052":"North America","084":"North America","124":"North America","188":"North America","192":"North America","212":"North America","214":"North America","222":"North America","308":"North America","320":"North America","332":"North America","340":"North America","388":"North America","484":"North America","558":"North America","591":"North America","659":"North America","662":"North America","670":"North America","780":"North America","840":"North America",
  // South America
  "032":"South America","068":"South America","076":"South America","152":"South America","170":"South America","218":"South America","328":"South America","600":"South America","604":"South America","740":"South America","858":"South America","862":"South America",
  // Oceania
  "036":"Oceania","242":"Oceania","296":"Oceania","584":"Oceania","583":"Oceania","520":"Oceania","554":"Oceania","585":"Oceania","598":"Oceania","882":"Oceania","090":"Oceania","776":"Oceania","798":"Oceania","548":"Oceania",
};
const TERR_CONTINENT={
  "puerto rico":"North America","guam":"Oceania","us virgin islands":"North America","american samoa":"Oceania","northern mariana islands":"Oceania","greenland":"North America","hong kong":"Asia","macau":"Asia","french guiana":"South America","french polynesia":"Oceania","new caledonia":"Oceania","reunion":"Africa","bermuda":"North America","cayman islands":"North America","gibraltar":"Europe","falkland islands":"South America","turks and caicos":"North America","british virgin islands":"North America","aruba":"North America","curacao":"North America","sint maarten":"North America","western sahara":"Africa","cook islands":"Oceania","niue":"Oceania","tokelau":"Oceania","faroe islands":"Europe","isle of man":"Europe","jersey":"Europe","guernsey":"Europe","norfolk island":"Oceania","christmas island":"Oceania","pitcairn islands":"Oceania",
};
const CONTINENT_ORDER=["Africa","Asia","Europe","North America","Oceania","South America"];
/* Build name → continent for O(1) lookup in the facts modal */
const NAME_CONTINENT={};
for(const[id,n]of Object.entries(ID_NAME)){if(ID_CONTINENT[id])NAME_CONTINENT[n]=ID_CONTINENT[id];}
for(const[key,t]of Object.entries(TERRITORIES)){if(TERR_CONTINENT[key])NAME_CONTINENT[t.name]=TERR_CONTINENT[key];}

export default function WorldQuiz(){
  const [started,setStarted]=useState(false);
  const [introExit,setIntroExit]=useState(false);
  const [showSettings,setShowSettings]=useState(false);
  const [settings,setSettings]=useState({
    autoZoom:true,
    hintType:'fill',
    difficulty:'easy',
    showOceans:true,
    theme:'dark',
    includeTerritories:true,
    clickToFill:true,
    hintsEnabled:true
  });
  const updateSetting=(key,val)=>setSettings(s=>({...s,[key]:val}));
  const effectiveClickToFill=settings.clickToFill&&settings.difficulty!=='hard';
  const [geo,setGeo]=useState(null);
  const [found,setFound]=useState(new Set());
  const [foundTerr,setFoundTerr]=useState(new Set());
  const [input,setInput]=useState("");
  const [msg,setMsg]=useState({text:"",type:"",key:0});
  const [factsLog,setFactsLog]=useState([]);
  const [showFacts,setShowFacts]=useState(false);
  const [factsSearch,setFactsSearch]=useState('');
  const [collapsedContinents,setCollapsedContinents]=useState(new Set());
  const [lastFound,setLastFound]=useState(null);
  const [seconds,setSeconds]=useState(0);
  const [playing,setPlaying]=useState(false);
  const [showCoffee,setShowCoffee]=useState(false);
  const [showList,setShowList]=useState(false);
  const [shake,setShake]=useState(false);
  const [transform,setTransform]=useState({x:0,y:0,k:1});
  const [tooltip,setTooltip]=useState(null);
  const [flashLabel,setFlashLabel]=useState(null);

  const inputRef=useRef(null);
  const svgRef=useRef(null);
  const gRef=useRef(null);
  const zoomRef=useRef(null);
  const animating=useRef(false);
  const timerRef=useRef(null);
  const wrapRef=useRef(null);
  const msgKey=useRef(0);
  const flashTimer=useRef(null);
  const flashKey=useRef(0);
  const [sparkles,setSparkles]=useState([]);

  /* ── Multiplayer ── */
  const [myId]=useState(()=>{let i=sessionStorage.getItem('cp_uid');if(!i){i=Math.random().toString(36).slice(2,11);sessionStorage.setItem('cp_uid',i);}return i;});
  const [gameMode,setGameMode]=useState(null); // null|'solo'|'multi'
  const [room,setRoom]=useState(null);
  const [isHost,setIsHost]=useState(false);
  const [nameInput,setNameInput]=useState('');
  const [joinCodeInput,setJoinCodeInput]=useState('');
  const [roomError,setRoomError]=useState('');
  const [lobbyMode,setLobbyMode]=useState('freeplay');
  const [lobbyTimerSecs,setLobbyTimerSecs]=useState(300);
  const [customTimerInput,setCustomTimerInput]=useState('');
  const [multiTimerLeft,setMultiTimerLeft]=useState(0);
  const [showBoard,setShowBoard]=useState(true);
  const multiRoomRef=useRef(null);
  const multiTimerRef=useRef(null);
  const prevRoomStatus=useRef(null);
  const myPlayerConnRef=useRef(null);

  /* ── Challenge / Leaderboard ── */
  const [isChallenge,setIsChallenge]=useState(false);
  const [challengeComplete,setChallengeComplete]=useState(false);
  const [challengeDNF,setChallengeDNF]=useState(false);
  const [lbEntries,setLbEntries]=useState([]);
  const [lbLoading,setLbLoading]=useState(false);
  const [showLeaderboard,setShowLeaderboard]=useState(false);
  const [challengeSubmitName,setChallengeSubmitName]=useState('');
  const [challengeSubmitStatus,setChallengeSubmitStatus]=useState('');
  const [submitting,setSubmitting]=useState(false);
  const savedSettings=useRef(null);

  const projection=useMemo(()=>d3.geoNaturalEarth1().scale(155).translate([W/2,H/2]),[]);
  const pathGen=useMemo(()=>d3.geoPath(projection),[projection]);

  const nameToId=useMemo(()=>{
    const m={};
    for(const[id,name]of Object.entries(ID_NAME))m[name.toLowerCase()]=id;
    for(const[alias,name]of Object.entries(ALIASES)){const id=m[name.toLowerCase()];if(id)m[alias.toLowerCase()]=id;}
    return m;
  },[]);

  /* Map of ISO numeric ID → territory key, for coloring polygons */
  const isoToTerrKey=useMemo(()=>{
    const m={};
    for(const[key,t]of Object.entries(TERRITORIES)){if(t.iso)m[t.iso]=key;}
    return m;
  },[]);

  /* Set of found territory ISO IDs for quick lookup during render */
  const foundTerrIsos=useMemo(()=>{
    const s=new Set();
    for(const key of foundTerr){const t=TERRITORIES[key];if(t&&t.iso)s.add(t.iso);}
    return s;
  },[foundTerr]);

  const [missingFromMap,setMissingFromMap]=useState(new Set(Object.keys(SMALL)));

  useEffect(()=>{
    /*
     * MAP SOURCE — Change this URL to use a different world map.
     * For India's official borders (including J&K, Aksai Chin), replace with:
     *   - Self-hosted: "/maps/topo.json"
     *   - GitHub: https://raw.githubusercontent.com/gotham13/World-Map-India-Complete/master/TopoJson/world.json
     * The code auto-detects both formats (world-atlas and India-complete).
     */
    const MAP_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json";
    fetch(MAP_URL)
      .then(r=>r.json()).then(t=>{
        /* Auto-detect object name: 'countries' (world-atlas) or 'topo' (India-complete) */
        const objName = t.objects.countries ? "countries" : Object.keys(t.objects)[0];
        const decoded=decodeTopo(t,objName);

        /* Build reverse A2→numeric map for files that use ISO_A2 instead of numeric IDs */
        const a2ToNum={};
        for(const[num,a2]of Object.entries(ID_A2)) a2ToNum[a2]=num;
        /* Add Kosovo and territory A2→numeric mappings */
        a2ToNum["XK"]="383";
        a2ToNum["PR"]="630";a2ToNum["GU"]="316";a2ToNum["AS"]="016";a2ToNum["MP"]="580";
        a2ToNum["GL"]="304";a2ToNum["HK"]="344";a2ToNum["GF"]="254";a2ToNum["PF"]="258";
        a2ToNum["NC"]="540";a2ToNum["KY"]="136";a2ToNum["FK"]="238";a2ToNum["TC"]="796";
        a2ToNum["AW"]="533";a2ToNum["CW"]="531";a2ToNum["EH"]="732";a2ToNum["CK"]="184";
        a2ToNum["FO"]="234";

        /* Assign/remap IDs based on format */
        /* Name-based mapping for entities with -99 ISO_A2 */
        const nameToNumeric={"Kosovo":"383","N. Cyprus":"196","Somaliland":"706"};
        for(const f of decoded.features){
          const props=f.properties||{};
          if(props.ISO_A2 && props.ISO_A2!=="-99" && a2ToNum[props.ISO_A2]){
            f.id=a2ToNum[props.ISO_A2];
          } else if(props.ISO_A2==="-99" && props.NAME && nameToNumeric[props.NAME]){
            /* Disputed entities: map by name */
            f.id=nameToNumeric[props.NAME];
          } else if(f.id==="-99" && !props.ISO_A2){
            /* world-atlas format: Kosovo */
            f.id="383";
          }
        }

        setGeo(decoded);
        const mapIds=new Set(decoded.features.map(f=>f.id));
        setMissingFromMap(new Set(Object.keys(SMALL).filter(id=>!mapIds.has(id))));
      })
      .catch(()=>flash("Failed to load map.","error"));
  },[]);

  useEffect(()=>{
    if(!svgRef.current||!started)return;
    const svg=d3.select(svgRef.current);
    const el=svgRef.current;
    const zoom=d3.zoom()
      .scaleExtent([1,12])
      .translateExtent([[0,0],[W,H]])
      .filter(e => {
        if (e.type === 'wheel') return e.ctrlKey; // only pinch-to-zoom via D3
        if (e.touches) return true;
        return !e.button;
      })
      .on("zoom",e=>{
        if(gRef.current)gRef.current.setAttribute('transform',`translate(${e.transform.x},${e.transform.y}) scale(${e.transform.k})`);
        if(!animating.current)setTransform({x:e.transform.x,y:e.transform.y,k:e.transform.k});
      });
    svg.call(zoom);
    zoomRef.current=zoom;

    /* Two-finger trackpad scroll → pan */
    const handleWheel = (e) => {
      e.preventDefault();
      if (e.ctrlKey) return; // pinch handled by D3
      const t = d3.zoomTransform(el);
      const k = t.k;
      let nx = t.x - e.deltaX;
      let ny = t.y - e.deltaY;
      nx = Math.min(0, Math.max(nx, W - W * k));
      ny = Math.min(0, Math.max(ny, H - H * k));
      svg.call(zoom.transform, d3.zoomIdentity.translate(nx, ny).scale(k));
    };
    el.addEventListener("wheel", handleWheel, {passive:false});

    return ()=>{svg.on(".zoom",null);el.removeEventListener("wheel",handleWheel);};
  },[geo,started]);

  useEffect(()=>{
    if(playing)timerRef.current=setInterval(()=>setSeconds(s=>s+1),1000);
    else clearInterval(timerRef.current);
    return ()=>clearInterval(timerRef.current);
  },[playing]);

  /* Subscribe to a Firebase room */
  const subscribeRoom=useCallback((code)=>{
    if(multiRoomRef.current){off(multiRoomRef.current);multiRoomRef.current=null;}
    const r=ref(db,`rooms/${code}`);
    onValue(r,snap=>{if(snap.exists())setRoom(snap.val());});
    multiRoomRef.current=r;
  },[]);

  /* React to room status transitions */
  useEffect(()=>{
    if(!room||gameMode!=='multi')return;
    const status=room.status;
    const me=room.players?.[myId];
    if(prevRoomStatus.current!=='playing'&&status==='playing'){
      if(me?.status!=='waiting'){
        setFound(new Set());setFoundTerr(new Set());setSeconds(0);
        setLastFound(null);setFlashLabel(null);setSparkles([]);setFactsLog([]);
        if(room.settings)setSettings(s=>({...s,...room.settings}));
        setStarted(true);setPlaying(true);
      }
    }
    if(status==='ended'){
      setPlaying(false);
      /* Re-activate waiting players so they're ready for next round */
      if(me?.status==='waiting')update(ref(db,`rooms/${room.code}/players/${myId}`),{status:'active'});
    }
    if(status==='lobby'&&prevRoomStatus.current==='ended'){
      /* Host started a new round — reset and go to lobby */
      setStarted(false);setFound(new Set());setFoundTerr(new Set());setSeconds(0);
      setLastFound(null);setFlashLabel(null);setSparkles([]);setFactsLog([]);
    }
    prevRoomStatus.current=status;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[room?.status]);

  /* Sync host settings to Firebase in lobby */
  useEffect(()=>{
    if(!isHost||!room?.code||room.status!=='lobby')return;
    update(ref(db,`rooms/${room.code}/settings`),settings);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[settings,isHost]);

  /* Countdown timer (multi/timed) */
  useEffect(()=>{
    clearInterval(multiTimerRef.current);
    if(!room||room.status!=='playing'||room.mode!=='timed')return;
    multiTimerRef.current=setInterval(()=>{
      const left=room.timerDuration-Math.floor((Date.now()-room.startedAt)/1000);
      if(left<=0){
        clearInterval(multiTimerRef.current);setMultiTimerLeft(0);
        update(ref(db,`rooms/${room.code}`),{status:'ended',endedAt:Date.now()});
      } else setMultiTimerLeft(left);
    },500);
    return ()=>clearInterval(multiTimerRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[room?.status,room?.startedAt]);

  /* Cleanup Firebase listener on unmount */
  useEffect(()=>()=>{
    if(multiRoomRef.current)off(multiRoomRef.current);
    clearInterval(multiTimerRef.current);
  },[]);

  const loadLeaderboard=useCallback(async()=>{
    setLbLoading(true);
    try{
      const snap=await get(ref(db,'leaderboard'));
      const arr=snap.exists()
        ?Object.entries(snap.val()).map(([id,e])=>({id,...e})).sort((a,b)=>a.time-b.time).slice(0,10)
        :[];
      setLbEntries(arr);
    }catch(e){}
    setLbLoading(false);
  },[]);

  /* Tab-away = DNF in challenge mode */
  useEffect(()=>{
    if(!isChallenge||!started||challengeComplete||challengeDNF)return;
    const onHide=()=>{if(document.hidden){setPlaying(false);setChallengeDNF(true);}};
    document.addEventListener('visibilitychange',onHide);
    return()=>document.removeEventListener('visibilitychange',onHide);
  },[isChallenge,started,challengeComplete,challengeDNF]);

  /* Challenge completion — all countries + all territories */
  useEffect(()=>{
    if(!isChallenge||!started||challengeComplete||challengeDNF)return;
    if(found.size===TOTAL&&foundTerr.size===TERR_TOTAL){
      setPlaying(false);setChallengeComplete(true);loadLeaderboard();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[found.size,foundTerr.size]);

  /* Register presence — sets connected=true and auto-clears to false on disconnect */
  const setupPresence=useCallback((code)=>{
    const connRef=ref(db,`rooms/${code}/players/${myId}/connected`);
    myPlayerConnRef.current=connRef;
    onDisconnect(connRef).set(false);
    set(connRef,true);
  },[myId]);

  /* Stale-room cleanup — runs at most once per 12 hours per browser */
  useEffect(()=>{
    const KEY='cp_last_cleanup';
    const now=Date.now();
    const last=parseInt(localStorage.getItem(KEY)||'0',10);
    if(now-last<12*60*60*1000)return;
    localStorage.setItem(KEY,String(now));
    const cutoff=now-12*60*60*1000;
    get(ref(db,'rooms')).then(snap=>{
      if(!snap.exists())return;
      const updates={};
      for(const[code,room] of Object.entries(snap.val())){
        const lastActive=room.lastActiveAt||room.startedAt||0;
        const anyConnected=room.players&&Object.values(room.players).some(p=>p.connected===true);
        if(lastActive<cutoff&&!anyConnected)updates[`rooms/${code}`]=null;
      }
      if(Object.keys(updates).length)update(ref(db),updates).catch(()=>{});
    }).catch(()=>{});
  },[]);

  const msgTimer=useRef(null);
  const flash=(text,type)=>{
    msgKey.current++;
    setMsg({text,type,key:msgKey.current});
    clearTimeout(msgTimer.current);
    msgTimer.current=setTimeout(()=>setMsg({text:"",type:"",key:msgKey.current}),5000);
  };
  const logFact=(name,fact)=>setFactsLog(prev=>[{name,fact,time:Date.now()},...prev]);
  const fmt=s=>`${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;

  const getCentroid=useCallback((id)=>{
    if(geo){const f=geo.features.find(f=>f.id===id);if(f){try{return pathGen.centroid(f.geometry);}catch(e){}}}
    if(SMALL[id])return projection([SMALL[id][1],SMALL[id][0]]);
    return null;
  },[geo,pathGen,projection]);

  const syncTransform=useCallback(()=>{
    if(!svgRef.current)return;
    animating.current=false;
    const t=d3.zoomTransform(svgRef.current);
    setTransform({x:t.x,y:t.y,k:t.k});
  },[]);

  const flyTo=useCallback((cx,cy)=>{
    if(!svgRef.current||!zoomRef.current)return;
    const svg=d3.select(svgRef.current);
    svg.interrupt();
    animating.current=true;
    const targetK=4.5;
    let tx=W/2-cx*targetK, ty=H/2-cy*targetK;
    tx=Math.min(0,Math.max(tx,W-W*targetK));
    ty=Math.min(0,Math.max(ty,H-H*targetK));
    svg.transition().duration(800).ease(d3.easeCubicInOut)
      .call(zoomRef.current.transform,d3.zoomIdentity.translate(tx,ty).scale(targetK))
      .on("end",syncTransform);
  },[syncTransform]);

  const resetZoom=useCallback(()=>{
    if(!svgRef.current||!zoomRef.current)return;
    const svg=d3.select(svgRef.current);
    svg.interrupt();
    animating.current=true;
    svg.transition().duration(600).ease(d3.easeCubicInOut)
      .call(zoomRef.current.transform,d3.zoomIdentity)
      .on("end",syncTransform);
  },[syncTransform]);

  const zoomIn=useCallback(()=>{
    if(!svgRef.current||!zoomRef.current)return;
    d3.select(svgRef.current).transition().duration(300).call(zoomRef.current.scaleBy,1.8);
  },[]);

  const zoomOut=useCallback(()=>{
    if(!svgRef.current||!zoomRef.current)return;
    d3.select(svgRef.current).transition().duration(300).call(zoomRef.current.scaleBy,0.55);
  },[]);

  /* Show temporary label at country centroid */
  const showFlashLabel=useCallback((id)=>{
    const c=getCentroid(id);
    if(!c)return;
    clearTimeout(flashTimer.current);
    flashKey.current++;
    setFlashLabel({id,name:`${getFlag(id)} ${ID_NAME[id]}`,cx:c[0],cy:c[1],fk:flashKey.current});
    /* Pre-generate sparkle positions so they don't change on re-render */
    const sp=Array.from({length:14},(_,i)=>{
      const a=(i/14)*Math.PI*2,d=12+Math.random()*22;
      return {x:c[0]+Math.cos(a)*d, y:c[1]+Math.sin(a)*d, r:2+Math.random()*3, delay:Math.random()*0.3};
    });
    setSparkles(sp);
    flashTimer.current=setTimeout(()=>{setFlashLabel(null);setSparkles([]);},3000);
  },[getCentroid]);

  /* Show temporary label at arbitrary coordinates (for territories) */
  const showFlashLabelAt=useCallback((name,cx,cy)=>{
    clearTimeout(flashTimer.current);
    flashKey.current++;
    setFlashLabel({id:'terr',name,cx,cy,fk:flashKey.current});
    const sp=Array.from({length:14},(_,i)=>{
      const a=(i/14)*Math.PI*2,d=12+Math.random()*22;
      return {x:cx+Math.cos(a)*d, y:cy+Math.sin(a)*d, r:2+Math.random()*3, delay:Math.random()*0.3};
    });
    setSparkles(sp);
    flashTimer.current=setTimeout(()=>{setFlashLabel(null);setSparkles([]);},4000);
  },[]);

  const handleGuess=useCallback(()=>{
    const raw=input.trim();const guess=raw.toLowerCase();
    if(!guess)return;
    if(!playing)setPlaying(true);

    /* Check territories */
    const terrKey=TERR_ALIASES[guess]||guess;
    const terr=TERRITORIES[terrKey];
    if(terr){
      logFact(terr.name,`Territory of ${terr.parent}. ${terr.fact}`);
      if(settings.includeTerritories){
        const pt=projection([terr.lng,terr.lat]);
        if(pt&&settings.autoZoom)flyTo(pt[0],pt[1]);
        const nextT=new Set(foundTerr);nextT.add(terrKey);setFoundTerr(nextT);
        if(gameMode==='multi'&&room?.code)set(ref(db,`rooms/${room.code}/players/${myId}/foundTerr/${terrKey}`),true);
        if(pt)showFlashLabelAt(terr.name,pt[0],pt[1]);
        flash(`📍 ${terr.name} — territory of ${terr.parent}. ${terr.fact}`,"territory");
      } else {
        /* Territories disabled — just show the fact, don't track */
        flash(`📍 ${terr.name} is a territory of ${terr.parent}. ${terr.fact}`,"territory");
      }
      setInput("");inputRef.current?.focus();return;
    }

    /* Try exact match first */
    let id=nameToId[guess];

    /* Easy mode: try partial/fuzzy match if exact fails */
    if(!id&&settings.difficulty==='easy'){
      const allEntries=Object.entries(nameToId);
      /* Try startsWith match */
      const startMatch=allEntries.find(([name])=>name.startsWith(guess)&&guess.length>=3);
      if(startMatch)id=startMatch[1];
      /* Try contains match if still no result */
      if(!id){
        const containsMatch=allEntries.find(([name])=>name.includes(guess)&&guess.length>=4);
        if(containsMatch)id=containsMatch[1];
      }
      /* Try fuzzy (typo) match — allow 1 edit for 6–11 chars, 2 edits for 12+ chars */
      if(!id&&guess.length>=6){
        const maxDist=Math.floor(guess.length/6);
        const fuzzyMatch=allEntries.find(([name])=>levenshtein(guess,name)<=maxDist);
        if(fuzzyMatch)id=fuzzyMatch[1];
      }
    }

    if(!id){
      setShake(true);setTimeout(()=>setShake(false),500);
      flash(`"${raw}" — not recognized. ${settings.difficulty==='hard'?'Exact spelling required!':'Check the spelling!'}`,"error");
      setInput("");inputRef.current?.focus();return;
    }
    if(found.has(id)){
      flash(`${getFlag(id)} ${ID_NAME[id]} already found!`,"warn");
      setInput("");inputRef.current?.focus();return;
    }
    const next=new Set(found);next.add(id);
    setFound(next);setLastFound(id);
    if(gameMode==='multi'&&room?.code)set(ref(db,`rooms/${room.code}/players/${myId}/found/${id}`),true);
    if(COUNTRY_FACTS[id])logFact(ID_NAME[id],COUNTRY_FACTS[id]);
    const centroid=getCentroid(id);
    if(centroid&&settings.autoZoom)flyTo(centroid[0],centroid[1]);
    showFlashLabel(id);
    if(next.size===TOTAL&&!isChallenge){
      setPlaying(false);
      flash(`🎉 ALL ${TOTAL} COUNTRIES in ${fmt(seconds)}! Geography master!`,"complete");
      if(settings.autoZoom)setTimeout(resetZoom,1500);
    } else {
      flash(`${getFlag(id)} ${ID_NAME[id]} found!  (${next.size}/${TOTAL})`,"success");
    }
    setInput("");inputRef.current?.focus();
  },[input,found,foundTerr,geo,playing,seconds,nameToId,getCentroid,flyTo,resetZoom,showFlashLabel,showFlashLabelAt,projection,settings,gameMode,room,myId,isChallenge]);

  const handleReset=()=>{
    setFound(new Set());setFoundTerr(new Set());setInput("");flash("","");setSeconds(0);
    setPlaying(false);setLastFound(null);setFlashLabel(null);setSparkles([]);setFactsLog([]);resetZoom();
  };

  const revealOne=()=>{
    const rem=Object.entries(ID_NAME).filter(([id])=>!found.has(id));
    if(!rem.length)return;
    if(!playing)setPlaying(true);
    const[id,name]=rem[Math.floor(Math.random()*rem.length)];
    const next=new Set(found);next.add(id);setFound(next);setLastFound(id);
    if(COUNTRY_FACTS[id])logFact(name,COUNTRY_FACTS[id]);
    const c=getCentroid(id);
    if(c&&settings.autoZoom)flyTo(c[0],c[1]);
    showFlashLabel(id);
    flash(`${getFlag(id)} Revealed: ${name}`,"hint");
  };

  const revealTerritory=()=>{
    const rem=Object.entries(TERRITORIES).filter(([key])=>!foundTerr.has(key));
    if(!rem.length){flash("All territories found!","success");return;}
    const[key,terr]=rem[Math.floor(Math.random()*rem.length)];
    const nextT=new Set(foundTerr);nextT.add(key);setFoundTerr(nextT);
    logFact(terr.name,`Territory of ${terr.parent}. ${terr.fact}`);
    const pt=projection([terr.lng,terr.lat]);
    if(pt&&settings.autoZoom)flyTo(pt[0],pt[1]);
    if(pt)showFlashLabelAt(terr.name,pt[0],pt[1]);
    flash(`📍 Revealed: ${terr.name} — territory of ${terr.parent}. ${terr.fact}`,"territory");
  };

  const getHint=()=>{
    if(!settings.hintsEnabled)return;
    const rem=Object.entries(ID_NAME).filter(([id])=>!found.has(id));
    if(!rem.length)return;
    if(settings.hintType==='fact'){
      /* Prefer countries that have facts */
      const withFacts=rem.filter(([id])=>COUNTRY_FACTS[id]);
      if(withFacts.length){
        const[id]=withFacts[Math.floor(Math.random()*withFacts.length)];
        flash(`🌍 ${COUNTRY_FACTS[id]}`,"hint");
      } else {
        /* All fact countries found — fall back to fill-the-gap */
        const[,name]=rem[Math.floor(Math.random()*rem.length)];
        const masked=name.split("").map((c,i)=>(i===0||c===" ")?c:Math.random()>0.45?c:"·").join("");
        flash(`💡 ${masked}`,"hint");
      }
    } else {
      const[,name]=rem[Math.floor(Math.random()*rem.length)];
      const masked=name.split("").map((c,i)=>(i===0||c===" ")?c:Math.random()>0.45?c:"·").join("");
      flash(`💡 ${masked}`,"hint");
    }
  };

  /* Hover tooltip handler — converts SVG mouse coords to screen coords */
  const handleMouseMove=useCallback((e,id)=>{
    if(!wrapRef.current||!ID_NAME[id])return;
    const rect=wrapRef.current.getBoundingClientRect();
    const isFound=found.has(id);
    const name=isFound?`${getFlag(id)} ${ID_NAME[id]}`:"???";
    setTooltip({name,x:e.clientX-rect.left,y:e.clientY-rect.top,found:isFound});
  },[found]);

  const handleMouseLeave=useCallback(()=>setTooltip(null),[]);

  const handleStart=(mode='solo')=>{
    setIntroExit(true);
    setTimeout(()=>{
      if(mode==='solo'){setGameMode('solo');setStarted(true);}
      else setGameMode('multi');
    },800);
  };

  const handleHome=()=>{
    endChallengeCleanup();
    if(myPlayerConnRef.current){
      try{onDisconnect(myPlayerConnRef.current).cancel();}catch(e){}
      myPlayerConnRef.current=null;
    }
    if(multiRoomRef.current){off(multiRoomRef.current);multiRoomRef.current=null;}
    clearInterval(multiTimerRef.current);
    setRoom(null);setIsHost(false);setGameMode(null);prevRoomStatus.current=null;setMultiTimerLeft(0);setRoomError('');
    setPlaying(false);
    setStarted(false);
    setIntroExit(false);
    setFound(new Set());
    setFoundTerr(new Set());
    setInput("");
    setMsg({text:"",type:"",key:0});
    setFactsLog([]);
    setLastFound(null);
    setSeconds(0);
    setFlashLabel(null);
    setSparkles([]);
    setTooltip(null);
    setTransform({x:0,y:0,k:1});
    setShowList(false);
    setShowFacts(false);
    setFactsSearch('');
    setCollapsedContinents(new Set());
    setShowCoffee(false);
  };

  /* ── Multiplayer handlers ── */
  const leaveRoom=useCallback(async(currentRoom,currentIsHost)=>{
    /* Cancel onDisconnect so Firebase doesn't write after we've already cleaned up */
    if(myPlayerConnRef.current){
      try{await onDisconnect(myPlayerConnRef.current).cancel();}catch(e){}
      myPlayerConnRef.current=null;
    }
    const code=(currentRoom??room)?.code;
    const host=currentIsHost??isHost;
    if(code){
      try{
        if(host){await remove(ref(db,`rooms/${code}`));}
        else{await remove(ref(db,`rooms/${code}/players/${myId}`));}
      }catch(e){}
    }
    if(multiRoomRef.current){off(multiRoomRef.current);multiRoomRef.current=null;}
    clearInterval(multiTimerRef.current);
    setRoom(null);setIsHost(false);setGameMode(null);setStarted(false);setIntroExit(false);
    setPlaying(false);setFound(new Set());setFoundTerr(new Set());setSeconds(0);
    setLastFound(null);setFlashLabel(null);setSparkles([]);setFactsLog([]);
    prevRoomStatus.current=null;setMultiTimerLeft(0);setRoomError('');setCustomTimerInput('');
  },[room,isHost,myId]);

  const createRoom=useCallback(async()=>{
    if(!nameInput.trim()){setRoomError('Enter your name first');return;}
    setRoomError('Creating…');
    try{
      const code=genCode();
      await Promise.all([
      set(ref(db,`rooms/${code}`),{
        code,hostId:myId,status:'lobby',
        settings:{...settings},mode:lobbyMode,timerDuration:lobbyTimerSecs,
        startedAt:0,endedAt:0,lastActiveAt:Date.now(),
        players:{[myId]:{name:nameInput.trim(),status:'active',joinedAt:Date.now()}}
      }),
      new Promise(r=>setTimeout(r,700))
      ]);
      setIsHost(true);subscribeRoom(code);setupPresence(code);setRoomError('');
    }catch(e){setRoomError(`Error: ${e.message}`);}
  },[nameInput,settings,lobbyMode,lobbyTimerSecs,myId,subscribeRoom,setupPresence]);

  const joinRoom=useCallback(async()=>{
    if(!nameInput.trim()){setRoomError('Enter your name first');return;}
    const code=joinCodeInput.trim().toUpperCase();
    if(code.length<4){setRoomError('Enter a room code');return;}
    setRoomError('Joining…');
    try{
    const snap=await get(ref(db,`rooms/${code}`));
    if(!snap.exists()){setRoomError('Room not found');return;}
    const data=snap.val();
    if(data.status==='ended'){setRoomError('This game has already ended');return;}
    if(data.players?.[myId]){setIsHost(data.hostId===myId);subscribeRoom(code);setupPresence(code);setRoomError('');return;}
    await update(ref(db,`rooms/${code}/players/${myId}`),{
      name:nameInput.trim(),
      status:data.status==='playing'?'waiting':'active',joinedAt:Date.now()
    });
    await update(ref(db,`rooms/${code}`),{lastActiveAt:Date.now()});
    setIsHost(false);subscribeRoom(code);setupPresence(code);setRoomError('');
    }catch(e){setRoomError(`Error: ${e.message}`);}
  },[nameInput,joinCodeInput,myId,subscribeRoom,setupPresence]);

  const startGame=useCallback(async()=>{
    if(!room||!isHost)return;
    const updates={};
    updates[`rooms/${room.code}/status`]='playing';
    updates[`rooms/${room.code}/startedAt`]=Date.now();
    updates[`rooms/${room.code}/lastActiveAt`]=Date.now();
    updates[`rooms/${room.code}/endedAt`]=0;
    updates[`rooms/${room.code}/mode`]=lobbyMode;
    updates[`rooms/${room.code}/timerDuration`]=lobbyTimerSecs;
    updates[`rooms/${room.code}/settings`]={...settings};
    if(room.players){
      for(const pid of Object.keys(room.players)){
        updates[`rooms/${room.code}/players/${pid}/found`]={};
        updates[`rooms/${room.code}/players/${pid}/foundTerr`]={};
        updates[`rooms/${room.code}/players/${pid}/status`]='active';
      }
    }
    await update(ref(db),updates);
  },[room,isHost,lobbyMode,lobbyTimerSecs,settings]);

  const endGame=useCallback(async()=>{
    if(!room||!isHost)return;
    await update(ref(db,`rooms/${room.code}`),{status:'ended',endedAt:Date.now()});
  },[room,isHost]);

  const startNewRound=useCallback(async()=>{
    if(!room||!isHost)return;
    await update(ref(db,`rooms/${room.code}`),{status:'lobby'});
  },[room,isHost]);

  const copyCode=useCallback(()=>{
    if(room?.code)navigator.clipboard.writeText(room.code).catch(()=>{});
  },[room?.code]);

  /* ── Challenge handlers ── */
  const startChallenge=useCallback(()=>{
    savedSettings.current={...settings};
    setSettings(s=>({...s,difficulty:'hard',hintsEnabled:false,includeTerritories:true,clickToFill:false,autoZoom:true}));
    setIsChallenge(true);setChallengeDNF(false);setChallengeComplete(false);
    setChallengeSubmitName('');setChallengeSubmitStatus('');setSubmitting(false);
    setFound(new Set());setFoundTerr(new Set());setFactsLog([]);setSeconds(0);setLastFound(null);
    setShowLeaderboard(false);
    setIntroExit(true);
    setTimeout(()=>{setGameMode('solo');setStarted(true);},800);
  },[settings]);

  const endChallengeCleanup=useCallback(()=>{
    setIsChallenge(false);setChallengeComplete(false);setChallengeDNF(false);
    if(savedSettings.current){setSettings(savedSettings.current);savedSettings.current=null;}
  },[]);

  const loadRazorpay=()=>new Promise(resolve=>{
    if(window.Razorpay){resolve(true);return;}
    const s=document.createElement('script');
    s.src='https://checkout.razorpay.com/v1/checkout.js';
    s.onload=()=>resolve(true);s.onerror=()=>resolve(false);
    document.body.appendChild(s);
  });

  const handleChallengePayment=useCallback(async()=>{
    if(!challengeSubmitName.trim()){setChallengeSubmitStatus('Enter your name first');return;}
    const loaded=await loadRazorpay();
    if(!loaded){setChallengeSubmitStatus('Payment service unavailable. Try again.');return;}
    setSubmitting(true);
    setChallengeSubmitStatus('');
    let orderId;
    try{
      const result=await httpsCallable(functions,'createOrder')();
      orderId=result.data.orderId;
    }catch(e){
      setChallengeSubmitStatus('Could not create order. Try again.');
      setSubmitting(false);
      return;
    }
    setSubmitting(false);
    const options={
      key:import.meta.env.VITE_RAZORPAY_KEY_ID,
      amount:9900,
      currency:'INR',
      order_id:orderId,
      name:'Cartographia',
      description:'World Record Board — Listing Fee',
      handler:async(response)=>{
        setSubmitting(true);
        try{
          await httpsCallable(functions,'verifyAndSaveScore')({
            orderId:response.razorpay_order_id,
            paymentId:response.razorpay_payment_id,
            signature:response.razorpay_signature,
            name:challengeSubmitName.trim(),
            time:seconds,
          });
          setChallengeSubmitStatus('success');
          await loadLeaderboard();
        }catch(e){
          setChallengeSubmitStatus(`Verification failed. Keep your payment ID: ${response.razorpay_payment_id}`);
        }
        setSubmitting(false);
      },
      prefill:{name:challengeSubmitName.trim()},
      theme:{color:'#f59e0b'},
      modal:{ondismiss:()=>setChallengeSubmitStatus('Payment cancelled.')},
    };
    new window.Razorpay(options).open();
  },[challengeSubmitName,seconds,loadLeaderboard]);

  /* Random country names for floating background */
  const floatingNames=useMemo(()=>{
    const names=Object.values(ID_NAME);
    const picked=[];
    const used=new Set();
    while(picked.length<28){
      const n=names[Math.floor(Math.random()*names.length)];
      if(!used.has(n)){used.add(n);picked.push(n);}
    }
    return picked.map((n,i)=>({
      name:n,
      x:5+Math.random()*90,
      y:5+Math.random()*90,
      dur:18+Math.random()*24,
      delay:-Math.random()*20,
      size:0.55+Math.random()*0.5,
      opacity:0.04+Math.random()*0.06
    }));
  },[]);

  const pct=Math.round((found.size/TOTAL)*100);
  const terrPct=Math.round((foundTerr.size/TERR_TOTAL)*100);
  return(
    <div className={`font-sans bg-bg text-tx ${settings.theme==='light'?'light':''}`}>

      {(!started&&gameMode===null) ? (
        <div className={`fixed inset-0 z-200 bg-bg flex flex-col items-center justify-center overflow-hidden px-6 py-10 gap-1 ${introExit?'animate-intro-exit':''}`}>
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
            {floatingNames.map((f,i)=>(
              <div key={i} className="float-name"
                style={{left:`${f.x}%`,top:`${f.y}%`,fontSize:`${f.size}rem`,
                  animationDuration:`${f.dur}s`,animationDelay:`${f.delay}s`,opacity:f.opacity}}>
                {f.name}
              </div>
            ))}
          </div>

          <div className="absolute h-px w-[60%] left-[20%] bg-gradient-to-r from-transparent via-ok/8 to-transparent" style={{top:'25%'}}/>
          <div className="absolute h-px w-[60%] left-[20%] bg-gradient-to-r from-transparent via-ok/8 to-transparent" style={{top:'75%'}}/>

          <div className="relative mb-[clamp(16px,3vh,32px)]">
            <div className="absolute inset-[clamp(-14px,-.5em,-20px)] border-2 border-ac/15 rounded-full" style={{animation:'ringPulse 3s ease-in-out infinite'}}/>
            <div className="absolute inset-[clamp(-24px,-1em,-36px)] border border-ok/10 rounded-full" style={{animation:'ringPulse 3s ease-in-out infinite .5s'}}/>
            <span className="block text-[clamp(3rem,6vh,5rem)]" style={{animation:'globeSpin 4s linear infinite'}}>🌍</span>
          </div>

          <h1 className="intro-title font-serif text-[clamp(2.5rem,7vw,4.5rem)] -tracking-wide mb-2 overflow-visible leading-[1.3] pt-1">
            {"Cartographia".split("").map((ch,i)=>(
              <span key={i} style={{animationDelay:`${0.15+i*0.05}s`}}>{ch}</span>
            ))}
          </h1>

          <p className="text-[clamp(0.9rem,2vw,1.15rem)] text-tx2 font-light tracking-wide opacity-0 mb-[clamp(16px,3vh,28px)]" style={{animation:'fadeUp .8s ease-out .8s forwards'}}>Can you name every country on Earth?</p>

          <div className="flex gap-[clamp(20px,5vw,36px)] mb-[clamp(20px,4vh,36px)] opacity-0" style={{animation:'fadeUp .6s ease-out 1.1s forwards'}}>
            <div className="text-center">
              <div className="font-serif text-[clamp(1.6rem,3vw,2.2rem)] leading-[1.3] pt-1 bg-gradient-to-br from-ac to-ac2 bg-clip-text text-transparent">197</div>
              <div className="text-[.7rem] text-tx2 uppercase tracking-[.12em] font-normal mt-0.5">Countries</div>
            </div>
            {settings.includeTerritories&&<div className="text-center">
              <div className="font-serif text-[clamp(1.6rem,3vw,2.2rem)] leading-[1.3] pt-1 bg-gradient-to-br from-ac to-ac2 bg-clip-text text-transparent">32</div>
              <div className="text-[.7rem] text-tx2 uppercase tracking-[.12em] font-normal mt-0.5">Territories</div>
            </div>}
            <div className="text-center">
              <div className="font-serif text-[clamp(1.6rem,3vw,2.2rem)] leading-[1.3] pt-1 bg-gradient-to-br from-ac to-ac2 bg-clip-text text-transparent">1</div>
              <div className="text-[.7rem] text-tx2 uppercase tracking-[.12em] font-normal mt-0.5">World</div>
            </div>
          </div>

          <div className="opacity-0 flex gap-3" style={{animation:'fadeUp .6s ease-out 1.4s forwards'}}>
            <button className="play-btn px-10 py-4 rounded-2xl border-none cursor-pointer font-sans text-[1.05rem] font-bold text-white tracking-wide bg-gradient-to-br from-ok to-emerald-700 relative overflow-hidden transition-all duration-300 hover:-translate-y-[3px] hover:scale-[1.03] hover:shadow-[0_8px_30px_var(--color-ok-g)]" onClick={()=>handleStart('solo')}>
              Solo
            </button>
            <button className="play-btn px-10 py-4 rounded-2xl border-none cursor-pointer font-sans text-[1.05rem] font-bold text-white tracking-wide bg-gradient-to-br from-blue-500 to-blue-700 relative overflow-hidden transition-all duration-300 hover:-translate-y-[3px] hover:scale-[1.03] hover:shadow-[0_8px_30px_rgba(59,130,246,.4)]" onClick={()=>handleStart('multi')}>
              Multiplayer
            </button>
          </div>

          <div className="opacity-0 flex gap-2.5" style={{animation:'fadeUp .5s ease-out 1.65s forwards'}}>
            <button className="px-6 py-2.5 rounded-[14px] border-none cursor-pointer font-sans text-[.88rem] font-bold text-white tracking-wide bg-gradient-to-br from-ac to-amber-600 transition-all duration-300 hover:-translate-y-[2px] hover:shadow-[0_6px_20px_rgba(245,158,11,.35)]" onClick={startChallenge}>
              🏆 Challenge
            </button>
            <button className="px-6 py-2.5 rounded-[14px] border border-bd bg-transparent cursor-pointer font-sans text-[.88rem] font-semibold text-tx2 tracking-wide transition-all duration-300 hover:border-tx2 hover:text-tx" onClick={async()=>{setShowLeaderboard(true);await loadLeaderboard();}}>
              📊 Leaderboard
            </button>
          </div>

          <p className="opacity-0 text-[.7rem] text-tx2 mt-3 font-light tracking-wide" style={{animation:'fadeUp .5s ease-out 1.9s forwards'}}>Type country names · Track your progress · Learn as you go</p>

          <button onClick={()=>setShowSettings(true)}
            className="opacity-0 mt-2 bg-transparent border border-bd text-tx2 px-5 py-2 rounded-[10px] cursor-pointer font-sans text-[.78rem] transition-all duration-200 flex items-center gap-1.5 hover:border-tx2 hover:text-tx"
            style={{animation:'fadeUp .5s ease-out 2.1s forwards'}}>
            ⚙ Settings
          </button>
        </div>
      ) : started ? (
      <div className="h-screen flex flex-col overflow-hidden animate-game-enter">
        {isChallenge&&(
          <div className="shrink-0 bg-gradient-to-r from-amber-600/20 via-amber-500/15 to-amber-600/20 border-b border-amber-500/30 px-4 py-1.5 flex items-center justify-center gap-2">
            <span className="text-[.65rem] font-bold uppercase tracking-[.12em] text-amber-400">🏆 Challenge Mode</span>
            <span className="text-[.58rem] text-amber-400/60">·</span>
            <span className="text-[.58rem] text-amber-400/70">Hard · No hints · All {TOTAL} countries + {TERR_TOTAL} territories · Tab away = disqualified</span>
          </div>
        )}
        <div className="px-6 pt-2 text-center shrink-0 relative">
          <button className="absolute left-4 top-1/2 -translate-y-1/2 bg-transparent border border-bd text-tx2 w-8 h-8 rounded-lg cursor-pointer flex items-center justify-center text-base transition-all duration-200 hover:border-ac hover:text-ac" onClick={handleHome} title="Back to Home">←</button>
          <h1 className="font-serif text-[1.8rem] -tracking-wide leading-[1.3] pt-0.5 bg-gradient-to-br from-slate-200 via-ac to-ok bg-clip-text text-transparent">Cartographia</h1>
          <p className="hidden">Name every country on Earth · {TOTAL} to find</p>
          {!isChallenge&&<button className="absolute right-4 top-1/2 -translate-y-1/2 bg-transparent border border-bd text-tx2 w-8 h-8 rounded-lg cursor-pointer flex items-center justify-center text-base transition-all duration-200 hover:border-ac hover:text-ac hover:rotate-45" onClick={()=>setShowSettings(true)} title="Settings">⚙</button>}
        </div>

        <div className="flex items-end justify-center gap-7 px-6 pt-3.5 pb-1.5 shrink-0 max-sm:gap-4 max-sm:px-3 max-sm:py-0.5">
          <div className="flex items-baseline gap-1">
            <span className="text-[.6rem] text-tx2 uppercase tracking-wide font-normal max-sm:text-[.5rem]">Countries</span>
            <span className="text-[.95rem] font-bold font-sans max-sm:text-[.85rem]" style={{color:"var(--color-ok)"}}>{found.size}<span className="font-normal text-tx2 text-[.7rem]">/{TOTAL}</span></span>
          </div>
          <div className="flex items-baseline gap-1">
            {gameMode==='multi'&&room?.mode==='timed'
              ?<span className={`text-[.9rem] font-bold font-sans tabular-nums ${multiTimerLeft<60?'text-red-400 animate-pulse':'text-ac2'}`}>{fmt(multiTimerLeft)} ⏱</span>
              :<span className="text-[.9rem] font-bold font-sans text-ac2 tabular-nums">{fmt(seconds)}</span>}
          </div>
          {settings.includeTerritories&&<div className="flex items-baseline gap-1">
            <span className="text-[.6rem] text-tx2 uppercase tracking-wide font-normal max-sm:text-[.5rem]">Territories</span>
            <span className="text-[.95rem] font-bold font-sans max-sm:text-[.85rem]" style={{color:"#60a5fa"}}>{foundTerr.size}<span className="font-normal text-tx2 text-[.7rem]">/{TERR_TOTAL}</span></span>
          </div>}
        </div>
        <div className="h-0.5 mx-6 rounded-sm bg-sf2 flex gap-0.5 overflow-hidden shrink-0">
          <div className="h-full rounded-sm bg-ok transition-[width] duration-600 ease-in-out" style={{width:`${pct}%`,flexBasis:0}}/>
          {settings.includeTerritories&&<div className="h-full rounded-sm bg-blue transition-[width] duration-600 ease-in-out" style={{width:`${terrPct}%`,flexBasis:0}}/>}
        </div>

        <div className="px-6 py-1 pb-2 mt-4 flex justify-center gap-1.5 flex-wrap shrink-0 max-sm:px-2.5 max-sm:py-0.5 max-sm:pb-1">
          <div className={`relative flex-1 max-w-[380px] min-w-40 ${shake?'animate-shake':''}`}>
            <input ref={inputRef} value={input} onChange={e=>setInput(e.target.value)}
              onKeyDown={e=>{if(e.key==="Enter")handleGuess();}}
              placeholder="Type a country name…" autoFocus autoComplete="off" spellCheck="false"
              className="w-full px-3.5 py-2 rounded-[10px] border-[1.5px] border-bd bg-sf text-tx text-[.9rem] font-sans outline-none transition-all duration-300 focus:border-ac focus:shadow-[0_0_12px_rgba(245,158,11,.12)] placeholder:text-tx2"/>
          </div>
          <button type="button" className="px-3.5 py-[7px] rounded-[10px] border-none cursor-pointer font-sans text-[.78rem] font-semibold transition-all duration-250 flex items-center gap-1 whitespace-nowrap bg-gradient-to-br from-ok to-emerald-700 text-white hover:-translate-y-px hover:shadow-[0_4px_12px_var(--color-ok-g)] max-sm:px-2.5 max-sm:py-1.5 max-sm:text-[.72rem]" onClick={handleGuess}>✓ Check</button>
          <button type="button" className={`px-3.5 py-[7px] rounded-[10px] font-sans text-[.78rem] font-semibold transition-all duration-250 flex items-center gap-1 whitespace-nowrap bg-sf2 border border-bd max-sm:px-2.5 max-sm:py-1.5 max-sm:text-[.72rem] ${settings.hintsEnabled?'cursor-pointer text-tx2 hover:border-ac hover:text-ac':'cursor-not-allowed text-tx2/40 border-bd/40'}`} onClick={getHint} title={settings.hintsEnabled?'':'Hints are disabled'}>💡 Hint</button>
        </div>

        <div className="text-center px-6 pb-0.5 min-h-5 shrink-0 flex justify-center my-2">
          {msg.text&&<span className={`inline-block text-[.82rem] font-semibold px-3.5 py-[3px] rounded-lg animate-msg-pop ${
            msg.type==='success'?'text-ok bg-ok/10':
            msg.type==='error'?'text-err bg-err/10':
            msg.type==='warn'?'text-ac bg-ac/10':
            msg.type==='hint'?'text-ac2 font-mono tracking-wide text-[.9rem] bg-ac2/8':
            msg.type==='complete'?'text-ac2 text-base bg-ac2/12':
            msg.type==='territory'?'text-blue bg-blue/10 text-[.78rem] max-w-[600px] text-left leading-snug':''
          }`} key={msg.key}>{msg.text}</span>}
        </div>

        <div className="map-wrap flex-1 relative min-h-0 overflow-hidden rounded-xl mx-2 mb-1" ref={wrapRef}>
          {/* Multiplayer scoreboard */}
          {gameMode==='multi'&&room&&room.status==='playing'&&(
            <div className="absolute top-2 left-2 z-5 bg-[rgba(14,23,41,.88)] border border-bd rounded-[10px] backdrop-blur-sm overflow-hidden animate-fi">
              <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-bd cursor-pointer select-none" onClick={()=>setShowBoard(v=>!v)}>
                <span className="text-[.58rem] font-bold uppercase tracking-[.1em] text-tx2">Players</span>
                <span className="text-[.5rem] text-tx2 opacity-50 ml-3">{showBoard?'▲':'▼'}</span>
              </div>
              {showBoard&&(
                <div className="flex flex-col gap-1.5 px-2.5 py-2 min-w-[160px]">
                  {room.players&&Object.entries(room.players).sort(([,a],[,b])=>Object.keys(b.found||{}).length-Object.keys(a.found||{}).length).map(([pid,p])=>{
                    const cnt=Object.keys(p.found||{}).length;
                    const isMe=pid===myId;
                    return(
                      <div key={pid} className="flex items-center gap-1.5">
                        <span className={`text-[.72rem] font-medium truncate w-20 ${isMe?'text-ok':'text-tx'}`}>{p.name}{isMe?' ★':''}</span>
                        <div className="flex-1 h-1 bg-sf2 rounded-full overflow-hidden"><div className={`h-full rounded-full transition-[width] duration-500 ${isMe?'bg-ok':'bg-blue'}`} style={{width:`${(cnt/TOTAL)*100}%`}}/></div>
                        <span className="text-[.65rem] text-tx2 tabular-nums w-8 text-right">{cnt}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          {/* Results overlay (active players) */}
          {gameMode==='multi'&&room?.status==='ended'&&started&&(
            <div className="absolute inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center z-20 animate-fi">
              <div className="bg-sf border border-bd rounded-[20px] p-6 w-[88%] max-w-[380px] animate-mi flex flex-col gap-4">
                <div className="text-center"><div className="text-[2.2rem]">🏆</div>
                  <h2 className="font-serif text-[1.5rem] text-tx mt-1">Round Over</h2>
                  <p className="text-[.72rem] text-tx2 mt-0.5">You found {found.size}/{TOTAL} countries</p>
                </div>
                <div className="flex flex-col gap-1.5">
                  {room.players&&Object.entries(room.players).sort(([,a],[,b])=>Object.keys(b.found||{}).length-Object.keys(a.found||{}).length).map(([pid,p],i)=>{
                    const cnt=Object.keys(p.found||{}).length;
                    const isMe=pid===myId;
                    return(<div key={pid} className={`flex items-center gap-2 px-3 py-1.5 rounded-[8px] ${isMe?'bg-ok/10 border border-ok/30':''}`}>
                      <span className="text-[.68rem] text-tx2 w-4 shrink-0">{i===0?'🥇':i===1?'🥈':i===2?'🥉':`${i+1}.`}</span>
                      <span className={`text-[.82rem] font-medium truncate flex-1 ${isMe?'text-ok':'text-tx'}`}>{p.name}{isMe?' (you)':''}</span>
                      <span className="text-[.78rem] font-bold text-ok tabular-nums">{cnt}</span>
                    </div>);
                  })}
                </div>
                <div className="flex gap-2">
                  {isHost&&<button className="flex-1 py-2 rounded-[10px] border-none cursor-pointer font-sans text-[.82rem] font-bold text-white bg-gradient-to-br from-ok to-emerald-700 hover:-translate-y-px transition-all duration-200" onClick={startNewRound}>New Round</button>}
                  <button className={`${isHost?'flex-1':'w-full'} py-2 rounded-[10px] border border-bd text-tx2 cursor-pointer font-sans text-[.82rem] font-semibold hover:border-tx2 hover:text-tx transition-all duration-200`} onClick={leaveRoom}>{isHost?'Close Room':'Leave Room'}</button>
                </div>
              </div>
            </div>
          )}
          {!geo?(
            <div className="flex items-center justify-center h-full text-tx2">
              <div className="text-center">
                <div className="text-[2rem]" style={{animation:"spin 1.2s linear infinite"}}>🌍</div>
                <div className="mt-2 text-[.8rem]">Loading world map…</div>
              </div>
            </div>
          ):(
            <svg ref={svgRef} className="world" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
              <defs>
                <filter id="glow"><feGaussianBlur stdDeviation="3" result="b"/>
                  <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
              </defs>
              <g ref={gRef}>
                <path d={pathGen({type:"Sphere"})} className="sph"/>
                <path d={pathGen(d3.geoGraticule10())} className="grat"/>

                {geo.features.map(f=>{
                  const isF=found.has(f.id);const isJ=lastFound===f.id;const nm=ID_NAME[f.id];
                  const isTerrFound=settings.includeTerritories&&foundTerrIsos.has(f.id);
                  const terrKey=isoToTerrKey[f.id];
                  const terrData=terrKey?TERRITORIES[terrKey]:null;
                  return(
                    <path key={f.id} d={pathGen(f.geometry)}
                      className={`cp${isF?' found':''}${isTerrFound?' terr-found':''}${isJ?' just':''}`}
                      style={isJ?{filter:"url(#glow)"}:undefined}
                      onMouseMove={e=>{
                        if(isTerrFound&&terrData){
                          if(!wrapRef.current)return;
                          const rect=wrapRef.current.getBoundingClientRect();
                          setTooltip({name:`${terrData.name} (${terrData.parent})`,x:e.clientX-rect.left,y:e.clientY-rect.top,found:true});
                        } else {
                          handleMouseMove(e,f.id);
                        }
                      }}
                      onMouseLeave={handleMouseLeave}
                      onClick={()=>{
                        if(isTerrFound&&terrData){flash(`📍 ${terrData.name} — territory of ${terrData.parent}. ${terrData.fact}`,"territory");}
                        else if(nm&&!isF&&effectiveClickToFill){setInput(nm);inputRef.current?.focus();}
                        else if(nm&&isF){showFlashLabel(f.id);}
                      }}>
                    </path>
                  );
                })}

                {Object.entries(SMALL).map(([id,[lat,lng]])=>{
                  if(!missingFromMap.has(id)||!found.has(id))return null;
                  const pt=projection([lng,lat]);if(!pt)return null;
                  const[x,y]=pt;const isJ=lastFound===id;
                  const r=Math.max(1.5, 4/transform.k);
                  return(
                    <circle key={`d-${id}`} cx={x} cy={y} r={r}
                      className={`dot found${isJ?' just':''}`}
                      fill="var(--color-ok)" stroke="#059669" strokeWidth={Math.max(0.3,0.8/transform.k)}
                      style={isJ?{filter:"url(#glow)"}:undefined}
                      onMouseMove={e=>handleMouseMove(e,id)}
                      onMouseLeave={handleMouseLeave}
                      onClick={()=>showFlashLabel(id)}>
                    </circle>
                  );
                })}

                {settings.includeTerritories&&[...foundTerr].map(key=>{
                  const t=TERRITORIES[key];if(!t)return null;
                  const pt=projection([t.lng,t.lat]);if(!pt)return null;
                  const[x,y]=pt;
                  const r=Math.max(1.5, 4/transform.k);
                  return(
                    <circle key={`terr-${key}`} cx={x} cy={y} r={r}
                      fill="#60a5fa" stroke="#3b82f6" strokeWidth={Math.max(0.3,0.8/transform.k)}
                      className="cursor-pointer"
                      onMouseMove={e=>{
                        if(!wrapRef.current)return;
                        const rect=wrapRef.current.getBoundingClientRect();
                        setTooltip({name:`${t.name} (${t.parent})`,x:e.clientX-rect.left,y:e.clientY-rect.top,found:true});
                      }}
                      onMouseLeave={handleMouseLeave}
                      onClick={()=>{
                        flash(`📍 ${t.name} — territory of ${t.parent}. ${t.fact}`,"territory");
                      }}/>
                  );
                })}

                {settings.showOceans&&[
                  {name:"NORTH ATLANTIC",lat:32,lng:-42},
                  {name:"SOUTH ATLANTIC",lat:-20,lng:-15},
                  {name:"NORTH PACIFIC",lat:28,lng:-170},
                  {name:"SOUTH PACIFIC",lat:-28,lng:-130},
                  {name:"INDIAN OCEAN",lat:-18,lng:78},
                  {name:"ARCTIC OCEAN",lat:84,lng:-30},
                  {name:"SOUTHERN OCEAN",lat:-62,lng:30},
                ].map((o,i)=>{
                  const pt=projection([o.lng,o.lat]);
                  if(!pt)return null;
                  return <text key={`ocean-${i}`} className="ocean-label" x={pt[0]} y={pt[1]}>{o.name}</text>;
                })}

                {sparkles.length>0&&sparkles.map((sp,i)=>(
                  <circle key={`sp-${i}`} cx={sp.x} cy={sp.y}
                    r={sp.r} fill="#fbbf24" className="sparkle" style={{animationDelay:`${sp.delay}s`}}/>
                ))}

                {flashLabel&&(
                  <g className="flash-g" key={`fl-${flashLabel.fk}`}>
                    {(()=>{
                      const tw=flashLabel.name.length*5+24;
                      return <>
                        <rect className="flash-pill" x={flashLabel.cx-tw/2} y={flashLabel.cy-22} width={tw} height={16} rx={5}/>
                        <text className="flash-text" x={flashLabel.cx} y={flashLabel.cy-11}>{flashLabel.name}</text>
                      </>;
                    })()}
                  </g>
                )}
              </g>
            </svg>
          )}

          {tooltip&&(
            <div className={`map-tooltip absolute pointer-events-none z-10 bg-[rgba(14,23,41,.92)] border border-ok rounded-lg px-3 py-[5px] text-[.78rem] font-semibold text-ok whitespace-nowrap -translate-x-1/2 -translate-y-[120%] shadow-[0_4px_16px_rgba(0,0,0,.4)] backdrop-blur-sm transition-opacity duration-150 ${tooltip.found?'':'unfound'}`} style={{left:tooltip.x,top:tooltip.y}}>
              {tooltip.name}
            </div>
          )}

          {geo&&(
            <>
              <div className="absolute bottom-3 right-3 flex flex-col gap-1 z-5">
                <button className="w-9 h-9 rounded-[10px] border border-bd bg-sf text-tx text-[1.1rem] cursor-pointer flex items-center justify-center transition-all duration-200 font-sans font-semibold hover:bg-sf2 hover:border-ac hover:text-ac max-sm:w-8 max-sm:h-8 max-sm:text-[.95rem]" onClick={zoomIn}>+</button>
                <button className="w-9 h-9 rounded-[10px] border border-bd bg-sf text-tx text-[1.1rem] cursor-pointer flex items-center justify-center transition-all duration-200 font-sans font-semibold hover:bg-sf2 hover:border-ac hover:text-ac max-sm:w-8 max-sm:h-8 max-sm:text-[.95rem]" onClick={zoomOut}>−</button>
                <button className="w-9 h-9 rounded-[10px] border border-bd bg-sf text-tx text-[.7rem] cursor-pointer flex items-center justify-center transition-all duration-200 font-sans font-semibold hover:bg-sf2 hover:border-ac hover:text-ac max-sm:w-8 max-sm:h-8" onClick={resetZoom}>⟲</button>
              </div>
              <div className="absolute bottom-3 left-3 text-[.65rem] text-tx2 bg-sf border border-bd rounded-lg px-2.5 py-[3px]">{transform.k.toFixed(1)}×</div>
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 text-[.5rem] text-slate-400/40 pointer-events-none whitespace-nowrap">Borders shown are approximate and may not reflect official positions of all countries</div>
              {settings.includeTerritories&&foundTerr.size>0&&<div className="absolute top-2.5 left-2.5 bg-[rgba(14,23,41,.88)] border border-bd rounded-[10px] px-3 py-2 flex flex-col gap-[5px] backdrop-blur-sm z-5 animate-fi">
                <div className="flex items-center gap-1.5 text-[.62rem] text-tx2 font-medium whitespace-nowrap"><span className="w-2 h-2 rounded-full shrink-0 bg-blue"></span>Not a sovereign country — governed by another nation</div>
              </div>}
            </>
          )}
        </div>

        {(found.size>0||(settings.includeTerritories&&foundTerr.size>0))&&(
          <>
            <div className="text-center px-6 py-px shrink-0">
              <button className="mx-auto px-3 py-[3px] rounded-[10px] cursor-pointer font-sans text-[.7rem] font-semibold transition-all duration-250 flex items-center gap-1 whitespace-nowrap bg-sf2 text-tx2 border border-bd hover:border-ac hover:text-ac"
                onClick={()=>setShowList(v=>!v)}>
                {showList?"▲ Hide":"▼ Show"} found ({found.size}{settings.includeTerritories&&foundTerr.size>0?` + ${foundTerr.size}`:''})
              </button>
            </div>
            <div className={`found-bar shrink-0 ${showList?'open':''}`}>
              <div className="flex flex-wrap gap-1 px-6 py-1 justify-center">
                {[...found].sort((a,b)=>(ID_NAME[a]||"").localeCompare(ID_NAME[b]||"")).map(id=>(
                  <span key={id} className="ft bg-sf2 border border-bd rounded-md px-2.5 py-0.5 text-[.66rem] text-ok">{getFlag(id)} {ID_NAME[id]}</span>
                ))}
                {settings.includeTerritories&&[...foundTerr].sort().map(key=>(
                  <span key={`t-${key}`} className="ft bg-sf2 border rounded-md px-2.5 py-0.5 text-[.66rem]" style={{color:"#60a5fa",borderColor:"rgba(96,165,250,.3)"}}>{TERRITORIES[key]?.name}</span>
                ))}
              </div>
            </div>
          </>
        )}

        <div className="flex justify-center gap-1.5 px-6 py-[3px] pb-2 flex-wrap shrink-0">
          {!isChallenge&&<button className="px-3.5 py-[7px] rounded-[10px] cursor-pointer font-sans text-[.78rem] font-semibold transition-all duration-250 flex items-center gap-1 whitespace-nowrap bg-sf2 text-tx2 border border-bd hover:border-ac hover:text-ac" onClick={handleReset}>↺ Reset</button>}
          {!isChallenge&&<button className="px-3.5 py-[7px] rounded-[10px] cursor-pointer font-sans text-[.78rem] font-semibold transition-all duration-250 flex items-center gap-1 whitespace-nowrap bg-sf2 text-tx2 border border-bd hover:border-ac hover:text-ac" onClick={revealOne}>👁 Reveal Country</button>}
          {!isChallenge&&settings.includeTerritories&&<button className="px-3.5 py-[7px] rounded-[10px] cursor-pointer font-sans text-[.78rem] font-semibold transition-all duration-250 flex items-center gap-1 whitespace-nowrap bg-sf2 border hover:border-ac hover:text-ac" style={{borderColor:"rgba(96,165,250,.3)",color:"#60a5fa"}} onClick={revealTerritory}>👁 Reveal Territory</button>}
          {factsLog.length>0&&<button className="px-3.5 py-[7px] rounded-[10px] cursor-pointer font-sans text-[.78rem] font-semibold transition-all duration-250 flex items-center gap-1 whitespace-nowrap bg-sf2 text-tx2 border border-bd hover:border-ac hover:text-ac" onClick={()=>setShowFacts(true)}>📖 Facts ({factsLog.length})</button>}
          {gameMode==='multi'&&isHost&&room?.status==='playing'&&<button className="px-3.5 py-[7px] rounded-[10px] cursor-pointer font-sans text-[.78rem] font-semibold transition-all duration-250 flex items-center gap-1 whitespace-nowrap border border-red-500/50 text-red-400 hover:bg-red-500/10 hover:border-red-400" onClick={endGame}>■ End Game</button>}
          {gameMode!=='multi'&&!isChallenge&&<button className="px-3.5 py-[7px] rounded-[10px] border-none cursor-pointer font-sans text-[.78rem] font-semibold transition-all duration-250 flex items-center gap-1 whitespace-nowrap bg-gradient-to-br from-amber-500 to-amber-600 text-white hover:-translate-y-px hover:shadow-[0_4px_12px_rgba(245,158,11,.3)]" onClick={()=>setShowCoffee(true)}>☕ Buy Me a Coffee</button>}
        </div>

        {showCoffee&&(
          <div className="fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center z-100 animate-fi" onClick={()=>setShowCoffee(false)}>
            <div className="bg-sf border border-bd rounded-[20px] p-7 max-w-[420px] w-[92%] text-center animate-mi" onClick={e=>e.stopPropagation()}>
              <div className="text-[2.8rem] mb-2">☕</div>
              <h2 className="font-serif text-[1.7rem] mb-1.5 bg-gradient-to-br from-ac to-ac2 bg-clip-text text-transparent">Buy Me a Coffee</h2>
              <p className="text-tx2 text-[.85rem] leading-relaxed mb-3">Enjoying Cartographia? Your support helps fuel new features — timed challenges, continent filters, capital cities mode, and multiplayer!</p>
              <a href="https://buymeacoffee.com" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-6 py-3 rounded-[14px] bg-gradient-to-br from-amber-500 to-amber-600 text-white font-bold text-[.95rem] border-none cursor-pointer transition-all duration-250 font-sans no-underline hover:-translate-y-0.5 hover:shadow-[0_6px_20px_rgba(245,158,11,.35)]">☕ Support This Project</a>
              <div className="mt-4">
                <p className="text-[.75rem] mb-1.5 text-ac2 font-semibold">💡 Suggest a Feature</p>
                <textarea className="w-full mt-2 px-3.5 py-2.5 rounded-[10px] border border-bd bg-bg text-tx font-sans text-[.82rem] resize-y min-h-[50px] outline-none placeholder:text-tx2 focus:border-ac" placeholder="What would you love to see?" rows={3}/>
                <button className="mt-2 w-full px-3.5 py-[7px] rounded-[10px] border-none cursor-pointer font-sans text-[.78rem] font-semibold transition-all duration-250 flex items-center justify-center gap-1 whitespace-nowrap bg-gradient-to-br from-ok to-emerald-700 text-white hover:-translate-y-px hover:shadow-[0_4px_12px_var(--color-ok-g)]"
                  onClick={()=>{setShowCoffee(false);flash("Thanks for your suggestion! 💛","success");}}>
                  Send Suggestion
                </button>
              </div>
              <button className="mt-3 bg-transparent border border-bd text-tx2 px-5 py-2 rounded-[10px] cursor-pointer font-sans text-[.82rem] transition-all duration-200 hover:border-tx2 hover:text-tx" onClick={()=>setShowCoffee(false)}>Maybe Later</button>
            </div>
          </div>
        )}

        {showFacts&&(
          <div className="fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center z-100 animate-fi" onClick={()=>{setShowFacts(false);setFactsSearch('');}}>
            <div className="bg-sf border border-bd rounded-[20px] p-7 max-w-[520px] w-[92%] animate-mi h-[80vh] flex flex-col" onClick={e=>e.stopPropagation()}>
              <div className="flex items-baseline justify-between mb-3">
                <h2 className="font-serif text-2xl text-tx">📖 Discovered Facts</h2>
                <span className="text-[.72rem] text-tx2">{factsLog.length} collected</span>
              </div>
              <input autoFocus value={factsSearch} onChange={e=>setFactsSearch(e.target.value)}
                placeholder="Search countries…" autoComplete="off" spellCheck="false"
                className="w-full px-3.5 py-2 rounded-[10px] border border-bd bg-bg text-tx text-[.82rem] font-sans outline-none mb-3 transition-all duration-300 focus:border-ac placeholder:text-tx2"/>
              <div className="facts-list flex-1 overflow-y-auto flex flex-col gap-3 pr-1 min-h-0">
                {(()=>{
                  const q=factsSearch.trim().toLowerCase();
                  const grouped={};
                  for(const f of factsLog){const c=NAME_CONTINENT[f.name]||'Other';if(!grouped[c])grouped[c]=[];grouped[c].push(f);}
                  for(const c of Object.keys(grouped))grouped[c].sort((a,b)=>a.name.localeCompare(b.name));
                  const sections=[...CONTINENT_ORDER,'Other'].filter(c=>grouped[c]).map(continent=>{
                    const all=grouped[continent];
                    const items=q?all.filter(f=>f.name.toLowerCase().includes(q)):all;
                    if(!items.length)return null;
                    const isOpen=q?true:!collapsedContinents.has(continent);
                    const toggle=()=>{
                      if(q)return;
                      setCollapsedContinents(prev=>{const n=new Set(prev);n.has(continent)?n.delete(continent):n.add(continent);return n;});
                    };
                    return(
                      <div key={continent} className="flex flex-col gap-2">
                        <div className="flex items-center justify-between pb-1 border-b border-bd cursor-pointer select-none group" onClick={toggle}>
                          <span className="text-[.58rem] font-bold uppercase tracking-[.14em] text-tx2">
                            {continent} <span className="font-normal opacity-50">({items.length}{!q&&items.length<all.length?`/${all.length}`:''})</span>
                          </span>
                          {!q&&<span className="text-[.55rem] text-tx2 opacity-40 group-hover:opacity-80 transition-opacity">{isOpen?'▼':'▶'}</span>}
                        </div>
                        {isOpen&&items.map((f,i)=>(
                          <div key={i} className="bg-sf2 border border-bd rounded-[10px] px-3.5 py-2.5 flex flex-col gap-1">
                            <span className="text-[.82rem] font-bold text-ok" style={f.fact.startsWith('Territory')?{color:'#60a5fa'}:undefined}>{f.name}</span>
                            <span className="text-[.75rem] text-tx2 leading-snug">{f.fact}</span>
                          </div>
                        ))}
                      </div>
                    );
                  });
                  const hasResults=sections.some(Boolean);
                  if(!hasResults)return <div className="text-center text-tx2 text-[.8rem] py-8">No results for &ldquo;{factsSearch}&rdquo;</div>;
                  return sections;
                })()}
              </div>
              <button className="w-full mt-4 py-2.5 rounded-xl border border-bd bg-transparent text-tx2 font-sans text-[.85rem] cursor-pointer transition-all duration-200 hover:border-tx2 hover:text-tx" onClick={()=>{setShowFacts(false);setFactsSearch('');}}>Close</button>
            </div>
          </div>
        )}
        {/* ── Challenge DNF overlay ── */}
        {isChallenge&&challengeDNF&&(
          <div className="fixed inset-0 bg-black/88 backdrop-blur-md flex items-center justify-center z-50 animate-fi">
            <div className="bg-sf border border-bd rounded-[20px] p-7 max-w-[380px] w-[92%] text-center animate-mi flex flex-col gap-4">
              <div className="text-[3rem]">🚫</div>
              <h2 className="font-serif text-[1.6rem] text-red-400">Challenge Disqualified</h2>
              <p className="text-[.82rem] text-tx2">You left the screen. The challenge requires your full attention — no tab switching.</p>
              <div className="bg-sf2 border border-bd rounded-[12px] px-4 py-2.5 text-left">
                <div className="text-[.6rem] text-tx2 uppercase tracking-[.1em] mb-1">Progress before exit</div>
                <div className="text-[.82rem] text-tx">{found.size}/{TOTAL} countries · {foundTerr.size}/{TERR_TOTAL} territories</div>
              </div>
              <div className="flex gap-2">
                <button className="flex-1 py-2.5 rounded-[10px] border-none cursor-pointer font-sans text-[.85rem] font-bold text-white bg-gradient-to-br from-ac to-amber-600 hover:-translate-y-px transition-all duration-200" onClick={()=>{handleHome();setTimeout(startChallenge,50);}}>Try Again</button>
                <button className="flex-1 py-2.5 rounded-[10px] border border-bd text-tx2 cursor-pointer font-sans text-[.85rem] hover:border-tx2 hover:text-tx transition-all duration-200" onClick={handleHome}>Home</button>
              </div>
            </div>
          </div>
        )}

        {/* ── Challenge complete overlay ── */}
        {isChallenge&&challengeComplete&&(
          <div className="fixed inset-0 bg-black/88 backdrop-blur-md flex items-center justify-center z-50 animate-fi">
            <div className="bg-sf border border-bd rounded-[20px] p-7 max-w-[460px] w-[92%] animate-mi flex flex-col gap-4 max-h-[92vh] overflow-y-auto">
              <div className="text-center">
                <div className="text-[3rem]">🏆</div>
                <h2 className="font-serif text-[1.8rem] mt-1 bg-gradient-to-br from-ac to-ac2 bg-clip-text text-transparent">Challenge Complete!</h2>
                <div className="font-mono text-[2.8rem] font-bold text-ok mt-1 tabular-nums">{fmt(seconds)}</div>
                <p className="text-[.72rem] text-tx2 mt-0.5">All {TOTAL} countries + {TERR_TOTAL} territories</p>
              </div>

              {lbLoading?(
                <div className="text-center text-tx2 text-[.82rem] py-2">Checking leaderboard…</div>
              ):(()=>{
                const rank=lbEntries.filter(e=>e.time<seconds).length+1;
                const inTop10=lbEntries.length<10||seconds<=(lbEntries[9]?.time??Infinity);
                return(
                  <>
                    {inTop10?(
                      <div className="bg-ok/10 border border-ok/30 rounded-[12px] p-3 text-center">
                        <p className="text-ok text-[.88rem] font-semibold">
                          {lbEntries.length===0?'🌟 First record on the board!':rank===1?'🥇 New #1 worldwide!':` You'd rank #${rank} worldwide!`}
                        </p>
                      </div>
                    ):(
                      <div className="bg-sf2 border border-bd rounded-[12px] p-3 text-center">
                        <p className="text-tx2 text-[.82rem]">Top 10 cutoff: {fmt(lbEntries[9].time)}</p>
                        <p className="text-tx2 text-[.72rem] mt-0.5">Keep practicing!</p>
                      </div>
                    )}

                    {inTop10&&challengeSubmitStatus!=='success'&&(
                      <div className="flex flex-col gap-2">
                        <input value={challengeSubmitName} onChange={e=>setChallengeSubmitName(e.target.value)}
                          placeholder="Your display name for the leaderboard"
                          className="w-full px-3.5 py-2 rounded-[10px] border border-bd bg-bg text-tx text-[.88rem] font-sans outline-none focus:border-ac transition-all duration-300 placeholder:text-tx2"/>
                        {challengeSubmitStatus&&challengeSubmitStatus!=='success'&&(
                          <p className="text-[.75rem] text-red-400">{challengeSubmitStatus}</p>
                        )}
                        <button onClick={handleChallengePayment} disabled={submitting}
                          className="py-2.5 rounded-[10px] border-none cursor-pointer font-sans text-[.9rem] font-bold text-white bg-gradient-to-br from-ac to-amber-600 hover:-translate-y-px transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed">
                          {submitting?'Saving…':'🏆 Submit Record — ₹99'}
                        </button>
                        <p className="text-[.6rem] text-tx2/60 text-center">Non-refundable listing fee · Supports India &amp; international cards/UPI · Powered by Razorpay</p>
                      </div>
                    )}

                    {challengeSubmitStatus==='success'&&(
                      <div className="bg-ok/10 border border-ok/30 rounded-[12px] p-3 text-center">
                        <p className="text-ok font-semibold text-[.88rem]">🎉 Record saved to the leaderboard!</p>
                      </div>
                    )}

                    {lbEntries.length>0&&(
                      <div className="bg-sf2 border border-bd rounded-[12px] p-3.5">
                        <div className="text-[.58rem] font-bold uppercase tracking-[.1em] text-tx2 mb-2">Current Top {lbEntries.length}</div>
                        <div className="flex flex-col gap-1.5">
                          {lbEntries.map((e,i)=>(
                            <div key={e.id} className="flex items-center gap-2">
                              <span className="text-base w-5 shrink-0 text-center">{i===0?'🥇':i===1?'🥈':i===2?'🥉':null}</span>
                              {i>2&&<span className="text-[.65rem] text-tx2 w-5 shrink-0 text-right">{i+1}.</span>}
                              <span className="text-[.78rem] text-tx font-medium truncate flex-1">{e.name}</span>
                              <span className="text-[.75rem] font-mono font-bold text-ok">{fmt(e.time)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                );
              })()}

              <button onClick={handleHome} className="py-2 rounded-[10px] border border-bd text-tx2 cursor-pointer font-sans text-[.82rem] hover:border-tx2 hover:text-tx transition-all duration-200">
                Back to Home
              </button>
            </div>
          </div>
        )}
      </div>
      ) : null}

      {/* ── Multiplayer pre-game screens ── */}
      {!started&&gameMode==='multi'&&(
        <div className="fixed inset-0 z-200 bg-bg flex flex-col items-center justify-center overflow-hidden px-6 py-10 animate-game-enter">
          {!room&&(
            <div className="w-full max-w-[400px] flex flex-col gap-4 animate-mi">
              <div className="text-center mb-1">
                <h1 className="font-serif text-[2.2rem] -tracking-wide bg-gradient-to-br from-slate-200 via-blue-400 to-blue-500 bg-clip-text text-transparent">Multiplayer</h1>
                <p className="text-[.78rem] text-tx2 mt-1">Compete with friends in real time</p>
              </div>

              {/* Step 1 — Name */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[.6rem] font-bold uppercase tracking-[.1em] text-tx2 px-0.5">Your display name</label>
                <input value={nameInput} onChange={e=>setNameInput(e.target.value)}
                  placeholder="Enter your name" autoFocus autoComplete="off"
                  className="w-full px-3.5 py-2.5 rounded-[10px] border border-bd bg-sf text-tx text-[.9rem] font-sans outline-none transition-all duration-300 focus:border-blue-400 placeholder:text-tx2"/>
              </div>

              {/* Step 2 — Create or Join */}
              <div className="flex flex-col gap-2.5">
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-px bg-bd"/>
                  <span className="text-[.58rem] font-bold uppercase tracking-[.1em] text-tx2">Create or join a room</span>
                  <div className="flex-1 h-px bg-bd"/>
                </div>

                {/* Create */}
                <div className="bg-sf2 border border-bd rounded-[14px] p-3.5 flex flex-col gap-2.5">
                  <div>
                    <span className="text-[.6rem] font-bold uppercase tracking-[.1em] text-tx2">New Room</span>
                    <p className="text-[.72rem] text-tx2 mt-0.5">Start a game and share the code with friends</p>
                  </div>
                  <button className="py-2.5 rounded-[10px] border-none cursor-pointer font-sans text-[.85rem] font-bold text-white bg-gradient-to-br from-blue-500 to-blue-700 transition-all duration-250 hover:-translate-y-px hover:shadow-[0_4px_16px_rgba(59,130,246,.4)]" onClick={createRoom}>+ Create Room</button>
                </div>

                {/* Join */}
                <div className="bg-sf2 border border-bd rounded-[14px] p-3.5 flex flex-col gap-2.5">
                  <div>
                    <span className="text-[.6rem] font-bold uppercase tracking-[.1em] text-tx2">Join Existing Room</span>
                    <p className="text-[.72rem] text-tx2 mt-0.5">Enter the code shared by the host</p>
                  </div>
                  <div className="flex gap-2">
                    <input value={joinCodeInput} onChange={e=>setJoinCodeInput(e.target.value.toUpperCase())} onKeyDown={e=>{if(e.key==='Enter')joinRoom();}}
                      placeholder="Room code" autoComplete="off" maxLength={6}
                      className="flex-1 px-3.5 py-2 rounded-[10px] border border-bd bg-bg text-tx text-[.9rem] font-sans outline-none transition-all duration-300 focus:border-blue-400 placeholder:text-tx2 uppercase tracking-[.12em] font-mono"/>
                    <button className="px-5 py-2 rounded-[10px] border-none cursor-pointer font-sans text-[.85rem] font-semibold text-white bg-gradient-to-br from-blue-500 to-blue-700 transition-all duration-250 hover:-translate-y-px whitespace-nowrap" onClick={joinRoom}>Join →</button>
                  </div>
                </div>
              </div>

              <p className="text-[.78rem] text-red-400 text-center min-h-[1.1rem]">{roomError}</p>
              <button className="bg-transparent border border-bd text-tx2 px-4 py-1.5 rounded-[10px] cursor-pointer font-sans text-[.78rem] hover:border-tx2 hover:text-tx transition-all duration-200 self-center" onClick={()=>{setGameMode(null);setIntroExit(false);}}>← Back</button>
            </div>
          )}

          {room&&room.status==='lobby'&&(
            <div className="w-full max-w-[480px] flex flex-col gap-3 animate-mi max-h-[90vh] overflow-y-auto pr-1">
              <div className="flex items-center justify-between shrink-0">
                <h2 className="font-serif text-[1.6rem] text-tx">Lobby</h2>
                <button className="bg-transparent border border-bd text-tx2 px-3 py-1 rounded-[8px] cursor-pointer font-sans text-[.72rem] hover:border-red-400 hover:text-red-400 transition-all duration-200" onClick={leaveRoom}>Leave</button>
              </div>
              <div className="bg-sf2 border border-bd rounded-[14px] p-4 flex items-center justify-between shrink-0">
                <div>
                  <div className="text-[.6rem] text-tx2 uppercase tracking-[.1em] mb-0.5">Room Code — share with friends</div>
                  <div className="font-mono text-[2rem] font-bold tracking-[.2em] text-ac">{room.code}</div>
                </div>
                <button className="bg-transparent border border-bd text-tx2 px-3 py-1.5 rounded-[8px] cursor-pointer font-sans text-[.72rem] hover:border-ac hover:text-ac transition-all duration-200" onClick={copyCode}>Copy</button>
              </div>
              <div className="bg-sf2 border border-bd rounded-[14px] p-3.5 shrink-0">
                <div className="text-[.6rem] text-tx2 uppercase tracking-[.1em] mb-2">Game Mode</div>
                <div className="flex gap-2">
                  {[['Freeplay','freeplay'],['Timed','timed']].map(([lbl,val])=>(
                    <button key={val} className={`flex-1 py-2 rounded-[8px] text-[.78rem] font-semibold font-sans border-none cursor-pointer transition-all duration-200 ${lobbyMode===val?val==='freeplay'?'bg-ok text-white':'bg-ac text-white':'bg-sf text-tx2 border border-bd'} ${!isHost?'opacity-60 pointer-events-none':''}`} onClick={()=>isHost&&setLobbyMode(val)}>{lbl}</button>
                  ))}
                </div>
                {lobbyMode==='timed'&&(
                  <div className="mt-2 flex gap-1.5 flex-wrap items-center">
                    {[['5 min',300],['10 min',600],['15 min',900],['20 min',1200]].map(([lbl,secs])=>(
                      <button key={secs} className={`px-3 py-1 rounded-[7px] text-[.7rem] font-semibold font-sans border cursor-pointer transition-all duration-200 ${lobbyTimerSecs===secs&&!customTimerInput?'bg-ac text-white border-ac':'bg-sf text-tx2 border-bd'} ${!isHost?'opacity-60 pointer-events-none':''}`}
                        onClick={()=>{if(!isHost)return;setLobbyTimerSecs(secs);setCustomTimerInput('');}}>{lbl}</button>
                    ))}
                    <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-[7px] border transition-all duration-200 bg-sf ${customTimerInput?'border-ac bg-ac/10':'border-bd'} ${!isHost?'opacity-60 pointer-events-none':''}`}>
                      <input
                        type="text" inputMode="numeric" maxLength={3}
                        value={customTimerInput}
                        onChange={e=>{
                          if(!isHost)return;
                          const v=e.target.value.replace(/\D/g,'');
                          setCustomTimerInput(v);
                          const mins=parseInt(v,10);
                          if(mins>0)setLobbyTimerSecs(mins*60);
                        }}
                        placeholder="—"
                        className={`w-8 text-[.7rem] font-sans outline-none text-center bg-transparent ${customTimerInput?'text-ac font-bold':'text-tx2'} placeholder:text-tx2/40`}
                      />
                      <span className="text-[.65rem] text-tx2 select-none">min</span>
                    </div>
                  </div>
                )}
              </div>
              <div className="flex items-center justify-between bg-sf2 border border-bd rounded-[14px] px-3.5 py-2.5 shrink-0">
                <span className="text-[.75rem] text-tx2">Difficulty: <span className="text-tx font-semibold">{settings.difficulty==='easy'?'Easy':'Hard'}</span> · Territories: <span className="text-tx font-semibold">{settings.includeTerritories?'On':'Off'}</span></span>
                {isHost&&<button className="bg-transparent border border-bd text-tx2 px-2.5 py-1 rounded-[7px] cursor-pointer font-sans text-[.7rem] hover:border-ac hover:text-ac transition-all duration-200" onClick={()=>setShowSettings(true)}>Edit ⚙</button>}
              </div>
              <div className="bg-sf2 border border-bd rounded-[14px] p-3.5 shrink-0">
                <div className="text-[.6rem] text-tx2 uppercase tracking-[.1em] mb-2">Players ({room.players?Object.keys(room.players).length:0})</div>
                <div className="flex flex-col gap-1.5">
                  {room.players&&Object.entries(room.players).map(([pid,p])=>(
                    <div key={pid} className="flex items-center gap-2">
                      <span className="text-[.8rem] font-medium text-tx truncate flex-1">{p.name}{pid===myId?' (you)':''}</span>
                      {pid===room.hostId&&<span className="text-[.6rem] bg-ac/20 text-ac px-1.5 py-0.5 rounded-md font-semibold">host</span>}
                    </div>
                  ))}
                </div>
              </div>
              {isHost ? (
                <button className="py-3 rounded-[12px] border-none cursor-pointer font-sans text-[.9rem] font-bold text-white bg-gradient-to-br from-ok to-emerald-700 transition-all duration-250 hover:-translate-y-px hover:shadow-[0_4px_16px_var(--color-ok-g)] shrink-0" onClick={startGame}>Start Game →</button>
              ) : (
                <p className="text-center text-[.78rem] text-tx2 py-1">Waiting for host to start…</p>
              )}
            </div>
          )}

          {room&&room.status==='playing'&&room.players?.[myId]?.status==='waiting'&&(
            <div className="w-full max-w-[400px] flex flex-col gap-4 animate-mi">
              <div className="text-center">
                <div className="text-[2.5rem] mb-2">⏳</div>
                <h2 className="font-serif text-[1.6rem] text-tx mb-1">Game in Progress</h2>
                <p className="text-[.78rem] text-tx2">You&rsquo;ll join automatically when this round ends.</p>
              </div>
              <div className="bg-sf2 border border-bd rounded-[14px] p-3.5">
                <div className="text-[.6rem] text-tx2 uppercase tracking-[.1em] mb-2">Live Scores</div>
                <div className="flex flex-col gap-2">
                  {room.players&&Object.entries(room.players).filter(([,p])=>p.status==='active').sort(([,a],[,b])=>Object.keys(b.found||{}).length-Object.keys(a.found||{}).length).map(([pid,p])=>{
                    const cnt=Object.keys(p.found||{}).length;
                    return(
                      <div key={pid} className="flex items-center gap-2">
                        <span className="text-[.78rem] font-medium text-tx truncate w-28">{p.name}{pid===myId?' (you)':''}</span>
                        <div className="flex-1 h-1.5 bg-sf rounded-full overflow-hidden"><div className="h-full bg-ok rounded-full transition-[width] duration-500" style={{width:`${(cnt/TOTAL)*100}%`}}/></div>
                        <span className="text-[.72rem] text-tx2 w-10 text-right tabular-nums">{cnt}/{TOTAL}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
              <button className="self-center bg-transparent border border-bd text-tx2 px-4 py-2 rounded-[10px] cursor-pointer font-sans text-[.8rem] hover:border-red-400 hover:text-red-400 transition-all duration-200" onClick={leaveRoom}>Leave Room</button>
            </div>
          )}

          {room&&room.status==='ended'&&(
            <div className="w-full max-w-[400px] flex flex-col gap-4 animate-mi">
              <div className="text-center"><div className="text-[2.5rem] mb-2">🏆</div>
                <h2 className="font-serif text-[1.6rem] text-tx mb-1">Round Over</h2>
              </div>
              <div className="bg-sf2 border border-bd rounded-[14px] p-3.5">
                <div className="text-[.6rem] text-tx2 uppercase tracking-[.1em] mb-2">Final Scores</div>
                <div className="flex flex-col gap-2">
                  {room.players&&Object.entries(room.players).sort(([,a],[,b])=>Object.keys(b.found||{}).length-Object.keys(a.found||{}).length).map(([pid,p],i)=>{
                    const cnt=Object.keys(p.found||{}).length;
                    return(<div key={pid} className="flex items-center gap-2">
                      <span className="text-[.68rem] text-tx2 w-5 shrink-0">{i+1}.</span>
                      <span className="text-[.82rem] font-medium text-tx truncate flex-1">{p.name}{pid===myId?' (you)':''}</span>
                      <span className="text-[.78rem] font-bold text-ok tabular-nums">{cnt}/{TOTAL}</span>
                    </div>);
                  })}
                </div>
              </div>
              <div className="flex gap-2">
                {isHost&&<button className="flex-1 py-2.5 rounded-[10px] border-none cursor-pointer font-sans text-[.85rem] font-bold text-white bg-gradient-to-br from-ok to-emerald-700 transition-all duration-250 hover:-translate-y-px" onClick={startNewRound}>New Round</button>}
                <button className={`${isHost?'flex-1':'w-full'} py-2.5 rounded-[10px] border border-bd text-tx2 cursor-pointer font-sans text-[.85rem] font-semibold hover:border-tx2 hover:text-tx transition-all duration-200`} onClick={leaveRoom}>{isHost?'Close Room':'Leave Room'}</button>
              </div>
            </div>
          )}
        </div>
      )}

      {showSettings&&(
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-250 flex items-center justify-center animate-fi" onClick={()=>setShowSettings(false)}>
          <div className="bg-sf border border-bd rounded-[20px] p-7 max-w-[440px] w-[92%] animate-mi" onClick={e=>e.stopPropagation()}>
            <h2 className="font-serif text-2xl mb-5 text-tx">⚙ Settings</h2>

            <div className="flex items-center justify-between py-3 border-b border-bd">
              <div className="flex flex-col gap-0.5">
                <span className="text-[.85rem] font-semibold text-tx">Auto-zoom on correct answer</span>
                <span className="text-[.68rem] text-tx2 leading-tight">Fly to the country when you guess it correctly</span>
              </div>
              <label className="relative w-11 h-6 shrink-0 cursor-pointer toggle">
                <input type="checkbox" checked={settings.autoZoom} onChange={e=>updateSetting('autoZoom',e.target.checked)}/>
                <div className="toggle-track absolute inset-0 bg-sf2 border border-bd rounded-xl transition-all duration-300"/>
                <div className="toggle-thumb absolute top-[3px] left-[3px] w-[18px] h-[18px] rounded-full bg-white transition-all duration-300 shadow-[0_1px_3px_rgba(0,0,0,.2)]"/>
              </label>
            </div>

            <div className="flex items-center justify-between py-3 border-b border-bd">
              <div className="flex flex-col gap-0.5">
                <span className="text-[.85rem] font-semibold text-tx">Hint type</span>
                <span className="text-[.68rem] text-tx2 leading-tight">{settings.hintType==='fill'?'Shows the name with missing letters':'Shows a fun fact about the country'}</span>
              </div>
              <div className="flex bg-sf2 border border-bd rounded-[10px] overflow-hidden shrink-0">
                <button className={`px-3.5 py-1.5 text-[.7rem] font-semibold font-sans border-none bg-transparent text-tx2 cursor-pointer transition-all duration-200 whitespace-nowrap ${settings.hintType==='fill'?'!bg-ok !text-white':''}`}
                  onClick={()=>updateSetting('hintType','fill')}>Fill the Gap</button>
                <button className={`px-3.5 py-1.5 text-[.7rem] font-semibold font-sans border-none bg-transparent text-tx2 cursor-pointer transition-all duration-200 whitespace-nowrap ${settings.hintType==='fact'?'!bg-ok !text-white':''}`}
                  onClick={()=>updateSetting('hintType','fact')}>Country Fact</button>
              </div>
            </div>

            <div className="flex items-center justify-between py-3 border-b border-bd">
              <div className="flex flex-col gap-0.5">
                <span className="text-[.85rem] font-semibold text-tx">Difficulty</span>
                <span className="text-[.68rem] text-tx2 leading-tight">{settings.difficulty==='easy'?'Accepts partial names (3+ letters)':'Requires exact spelling'}</span>
              </div>
              <div className="flex bg-sf2 border border-bd rounded-[10px] overflow-hidden shrink-0">
                <button className={`px-3.5 py-1.5 text-[.7rem] font-semibold font-sans border-none bg-transparent text-tx2 cursor-pointer transition-all duration-200 whitespace-nowrap ${settings.difficulty==='easy'?'!bg-ok !text-white':''}`}
                  onClick={()=>updateSetting('difficulty','easy')}>Easy</button>
                <button className={`px-3.5 py-1.5 text-[.7rem] font-semibold font-sans border-none bg-transparent text-tx2 cursor-pointer transition-all duration-200 whitespace-nowrap ${settings.difficulty==='hard'?'!bg-ac !text-white':''}`}
                  onClick={()=>updateSetting('difficulty','hard')}>Hard</button>
              </div>
            </div>

            <div className="flex items-center justify-between py-3 border-b border-bd">
              <div className="flex flex-col gap-0.5">
                <span className="text-[.85rem] font-semibold text-tx">Ocean labels</span>
                <span className="text-[.68rem] text-tx2 leading-tight">Show ocean names on the map</span>
              </div>
              <label className="relative w-11 h-6 shrink-0 cursor-pointer toggle">
                <input type="checkbox" checked={settings.showOceans} onChange={e=>updateSetting('showOceans',e.target.checked)}/>
                <div className="toggle-track absolute inset-0 bg-sf2 border border-bd rounded-xl transition-all duration-300"/>
                <div className="toggle-thumb absolute top-[3px] left-[3px] w-[18px] h-[18px] rounded-full bg-white transition-all duration-300 shadow-[0_1px_3px_rgba(0,0,0,.2)]"/>
              </label>
            </div>

            <div className="flex items-center justify-between py-3 border-b border-bd">
              <div className="flex flex-col gap-0.5">
                <span className="text-[.85rem] font-semibold text-tx">Include territories</span>
                <span className="text-[.68rem] text-tx2 leading-tight">{settings.includeTerritories?'Territories like Puerto Rico and Greenland are discoverable as bonus finds':'Only the 197 sovereign countries are tracked'}</span>
              </div>
              <label className="relative w-11 h-6 shrink-0 cursor-pointer toggle">
                <input type="checkbox" checked={settings.includeTerritories} onChange={e=>updateSetting('includeTerritories',e.target.checked)}/>
                <div className="toggle-track absolute inset-0 bg-sf2 border border-bd rounded-xl transition-all duration-300"/>
                <div className="toggle-thumb absolute top-[3px] left-[3px] w-[18px] h-[18px] rounded-full bg-white transition-all duration-300 shadow-[0_1px_3px_rgba(0,0,0,.2)]"/>
              </label>
            </div>

            <div className={`flex items-center justify-between py-3 border-b border-bd${settings.difficulty==='hard'?' opacity-50':''}`}>
              <div className="flex flex-col gap-0.5">
                <span className="text-[.85rem] font-semibold text-tx">Click country to fill input</span>
                <span className="text-[.68rem] text-tx2 leading-tight">{settings.difficulty==='hard'?'Disabled in Hard mode':'Clicking an unfound country enters its name in the input'}</span>
              </div>
              <label className={`relative w-11 h-6 shrink-0 toggle${settings.difficulty==='hard'?'':' cursor-pointer'}`}>
                <input type="checkbox" checked={effectiveClickToFill} disabled={settings.difficulty==='hard'} onChange={e=>updateSetting('clickToFill',e.target.checked)}/>
                <div className="toggle-track absolute inset-0 bg-sf2 border border-bd rounded-xl transition-all duration-300"/>
                <div className="toggle-thumb absolute top-[3px] left-[3px] w-[18px] h-[18px] rounded-full bg-white transition-all duration-300 shadow-[0_1px_3px_rgba(0,0,0,.2)]"/>
              </label>
            </div>

            <div className="flex items-center justify-between py-3 border-b border-bd">
              <div className="flex flex-col gap-0.5">
                <span className="text-[.85rem] font-semibold text-tx">Hints</span>
                <span className="text-[.68rem] text-tx2 leading-tight">{settings.hintsEnabled?'💡 Hint button is available':'Hint button is hidden — pure challenge mode'}</span>
              </div>
              <label className="relative w-11 h-6 shrink-0 cursor-pointer toggle">
                <input type="checkbox" checked={settings.hintsEnabled} onChange={e=>updateSetting('hintsEnabled',e.target.checked)}/>
                <div className="toggle-track absolute inset-0 bg-sf2 border border-bd rounded-xl transition-all duration-300"/>
                <div className="toggle-thumb absolute top-[3px] left-[3px] w-[18px] h-[18px] rounded-full bg-white transition-all duration-300 shadow-[0_1px_3px_rgba(0,0,0,.2)]"/>
              </label>
            </div>

            <div className="flex items-center justify-between py-3">
              <div className="flex flex-col gap-0.5">
                <span className="text-[.85rem] font-semibold text-tx">Theme</span>
                <span className="text-[.68rem] text-tx2 leading-tight">{settings.theme==='dark'?'Dark mode — easier on the eyes':'Light mode — classic atlas look'}</span>
              </div>
              <div className="flex bg-sf2 border border-bd rounded-[10px] overflow-hidden shrink-0">
                <button className={`px-3.5 py-1.5 text-[.7rem] font-semibold font-sans border-none bg-transparent text-tx2 cursor-pointer transition-all duration-200 whitespace-nowrap ${settings.theme==='dark'?'!bg-blue !text-white':''}`}
                  onClick={()=>updateSetting('theme','dark')}>🌙 Dark</button>
                <button className={`px-3.5 py-1.5 text-[.7rem] font-semibold font-sans border-none bg-transparent text-tx2 cursor-pointer transition-all duration-200 whitespace-nowrap ${settings.theme==='light'?'!bg-ac !text-white':''}`}
                  onClick={()=>updateSetting('theme','light')}>☀️ Light</button>
              </div>
            </div>

            <button className="w-full mt-4 py-2.5 rounded-xl border border-bd bg-transparent text-tx2 font-sans text-[.85rem] cursor-pointer transition-all duration-200 hover:border-tx2 hover:text-tx" onClick={()=>setShowSettings(false)}>Done</button>
          </div>
        </div>
      )}

      {/* ── Leaderboard modal (from landing page) ── */}
      {showLeaderboard&&(
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center z-250 animate-fi" onClick={()=>setShowLeaderboard(false)}>
          <div className="bg-sf border border-bd rounded-[20px] p-7 max-w-[440px] w-[92%] animate-mi flex flex-col gap-4 max-h-[88vh] overflow-y-auto" onClick={e=>e.stopPropagation()}>
            <div className="text-center">
              <div className="text-[2.8rem]">🏆</div>
              <h2 className="font-serif text-[1.8rem] mt-1 text-tx">World Record Board</h2>
              <p className="text-[.72rem] text-tx2 mt-1">Fastest to name all {TOTAL} countries + {TERR_TOTAL} territories<br/>Hard mode · No hints · No tab switching</p>
            </div>

            {lbLoading?(
              <div className="text-center text-tx2 py-6 text-[.85rem]">Loading…</div>
            ):lbEntries.length===0?(
              <div className="text-center text-tx2 py-6">
                <p className="text-[.9rem]">No records yet.</p>
                <p className="text-[.78rem] mt-1 opacity-60">Be the first to set a world record!</p>
              </div>
            ):(
              <div className="bg-sf2 border border-bd rounded-[14px] p-4 flex flex-col gap-2">
                {lbEntries.map((e,i)=>(
                  <div key={e.id} className="flex items-center gap-2.5">
                    <span className="text-lg w-7 shrink-0 text-center">{i===0?'🥇':i===1?'🥈':i===2?'🥉':null}</span>
                    {i>2&&<span className="text-[.68rem] text-tx2 w-7 shrink-0 text-right font-mono">{i+1}.</span>}
                    <span className="text-[.85rem] text-tx font-medium truncate flex-1">{e.name}</span>
                    <span className="text-[.85rem] font-mono font-bold text-ok">{fmt(e.time)}</span>
                  </div>
                ))}
              </div>
            )}

            <button onClick={()=>{setShowLeaderboard(false);startChallenge();}}
              className="py-2.5 rounded-[12px] border-none cursor-pointer font-sans text-[.9rem] font-bold text-white bg-gradient-to-br from-ac to-amber-600 hover:-translate-y-px hover:shadow-[0_6px_20px_rgba(245,158,11,.3)] transition-all duration-200">
              🏆 Take the Challenge
            </button>
            <button onClick={()=>setShowLeaderboard(false)}
              className="py-2 rounded-[10px] border border-bd text-tx2 cursor-pointer font-sans text-[.82rem] hover:border-tx2 hover:text-tx transition-all duration-200">
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
