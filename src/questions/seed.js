// Offline fallback so the game always has something to serve, even if every online source is down.
// Hand-checked facts that don't change. Add your own - format is [question, correct, wrong, category].
const { makeQuestion, shuffle } = require('./util');

const SEED = [
  ['What is the largest planet in our solar system?', 'Jupiter', 'Saturn', 'Science'],
  ['Which is the longest river in South America?', 'Amazon', 'Orinoco', 'Geography'],
  ['Which ocean is larger?', 'Pacific', 'Atlantic', 'Geography'],
  ['Which country has the most people?', 'India', 'United States', 'Geography'],
  ['What is the capital of Australia?', 'Canberra', 'Sydney', 'Geography'],
  ['What is the capital of Canada?', 'Ottawa', 'Toronto', 'Geography'],
  ['What is the capital of Brazil?', 'Brasilia', 'Rio de Janeiro', 'Geography'],
  ['Which is the tallest mountain above sea level?', 'Mount Everest', 'K2', 'Geography'],
  ['Which animal is the fastest on land?', 'Cheetah', 'Lion', 'Nature'],
  ['Which is the largest living bird?', 'Ostrich', 'Emu', 'Nature'],
  ['Which is the largest mammal?', 'Blue whale', 'African elephant', 'Nature'],
  ['How many hearts does an octopus have?', 'Three', 'Two', 'Nature'],
  ['Which element has the chemical symbol Au?', 'Gold', 'Silver', 'Science'],
  ['Which element has the chemical symbol Fe?', 'Iron', 'Lead', 'Science'],
  ['What is the hardest natural substance?', 'Diamond', 'Quartz', 'Science'],
  ['Which planet is closest to the Sun?', 'Mercury', 'Venus', 'Science'],
  ['Who painted the Mona Lisa?', 'Leonardo da Vinci', 'Michelangelo', 'Art'],
  ['Who wrote "Romeo and Juliet"?', 'William Shakespeare', 'Christopher Marlowe', 'Literature'],
  ['Who wrote "Pride and Prejudice"?', 'Jane Austen', 'Charlotte Bronte', 'Literature'],
  ['Which US president appears on the one-dollar bill?', 'George Washington', 'Abraham Lincoln', 'History'],
  ['Which US president appears on the five-dollar bill?', 'Abraham Lincoln', 'Thomas Jefferson', 'History'],
  ['Which year did the Titanic sink?', '1912', '1915', 'History'],
  ['Which year did World War II end?', '1945', '1943', 'History'],
  ['Which city hosted the 2016 Summer Olympics?', 'Rio de Janeiro', 'London', 'Sports'],
  ['How many players are on the field for one soccer team?', 'Eleven', 'Ten', 'Sports'],
  ['In tennis, which Grand Slam is played on clay?', 'French Open', 'Wimbledon', 'Sports'],
  ['Which country invented pizza?', 'Italy', 'Greece', 'Food'],
  ['Which is the main ingredient of guacamole?', 'Avocado', 'Cucumber', 'Food'],
  ['Which country is sushi most associated with?', 'Japan', 'China', 'Food'],
  ['Which spice comes from the Crocus flower?', 'Saffron', 'Turmeric', 'Food'],
  ['How many strings does a standard guitar have?', 'Six', 'Seven', 'Music'],
  ['Which instrument has 88 keys?', 'Piano', 'Organ', 'Music'],
  ['Which is the smallest US state by area?', 'Rhode Island', 'Delaware', 'Geography'],
  ['Which is the largest US state by area?', 'Alaska', 'Texas', 'Geography'],
  ['What is the largest desert in the world, including polar deserts?', 'Antarctic', 'Sahara', 'Geography'],
  ['How many continents are there?', 'Seven', 'Six', 'Geography'],
  ['What gas do plants absorb from the air?', 'Carbon dioxide', 'Nitrogen', 'Science'],
  ['What is the boiling point of water at sea level in Celsius?', '100', '90', 'Science'],
  ['Which blood type is the universal donor for red cells?', 'O negative', 'AB positive', 'Science'],
  ['Which company makes the iPhone?', 'Apple', 'Samsung', 'Tech'],
];

function fetchQuestions(count) {
  return Promise.resolve(
    shuffle(SEED).slice(0, count).map(([q, correct, wrong, category]) =>
      makeQuestion({ q, correct, wrong, category, source: 'seed' }),
    ),
  );
}

module.exports = { fetchQuestions, name: 'seed' };
