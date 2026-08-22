# Prompts (in order)

The prompts I gave, in order, verbatim.

---

Emergence

---

## 1

hey! I have a problem statement with me and i have a solution for it in mind, i want you to pinpoint problems in my current solution, offer suggestions and better approaches for the problem.

First let me define the problem/product requirement:- Partners spend ~10 hours/week scanning Product Hunt, YC, Hacker News, Twitter/X, and Crunchbase for promising startups, then writing memos by hand. Most candidates get passed on. Your job is to build the first version of an internal pipeline that automates the triage layer so partners can spend their time on the top 10%.

The solution that i have in mind:- I want to create an AI agent which will act as the main orchestrator - will take decisions to spin up parallel subagents for tasks such as sourcing, analysis, Recommendation. Let me define each of the subagent tasks -> given a query or a list of urls it's task will be to collect 10–20 candidate startups with: name, website, one-line description, founders/team signal where findable, and at least one freshness or traction signal (recent launch, funding, HN traction, GitHub activity. Analysis will have to analyze each startup and produce the following findings information about the team -> founder backgrounds, prior exits, technical depth - anything that will give me insights on how strong the team is and how strong each member is and how they contribure in the team, their strengths and weaknesses. Product - what they actually do, how are they able to do it, technology they are using. Market - a detailed study on the product market like a product market fit, how big the market is, any existing players, their market share. Risks -> competition, things that are hurting the proct right now, could be anything investments, competitions, economy, geoplitics etc. Based on this we'll assign a score to this. Note:- The score will be algorithmic (no llms to be used for this).
Last subagent would be for Recommendation that would take input from the above two subagents and based on their output and the analysis score assign one of the 3 "Pass / Watch / Take a meeting" with proper explaination. But with that also assign 3-4 pointers that might change my mind.

Tech stack -> Use eve (next js) for agents, typescript as the language.
Design patterns -> Use singleton pattern, strategy and adapter patterns for the sources, LLMs, factory pattern for creating agents, chain of responsibility, Specification Pattern.

Use the compound engineering SKILL and refine the solution. Create a detailed plan for it

---

## 2

Also if a subagent fails then i want that the agent should take the error message and then spin up the subagent again (correcting the previous mistakes this time). Please add that retry logic here in the plan and add another plan for this in the plans folder

---

## 3

Perfect! Use context7 mcp tools for referring to proper documetation, compound engineering SKILLS for writing quality code and polytail SKILL so that you do not over optimize the code. You are free to run multiple parallel agents for this. Please do not change the business logic at all, If you have any doubts please ask. Do not assume things on your own. Follow the plan in the @plans section and start working on the project. After creating a feature/task, i want you to perform thorough testing for it and then only commit it and move forward. Make sure to add proper logging and tracing at each step. Intialize the project first and then wait for my command to move ahead

---

## 4

Durint the project setup and initialization, i want to create a folder "memos" in which you'll have to store all the memos that the user created in a .md file

---

## 5

perfect! Now please check if it is wokring if im using bedrock, use my acc and check if it is working for the bedrock model or not, use my personal profile for that, perform all kinds of e2e tests using it.

---

## 6

why did the cursor research fail on giving founder's history? Is the web search working?

---


## 7

Okay so a couple of fixes that i need:-
1. You are not giving detailed insights on every team member, you are just telling me the history of the CEO, i want the history of all the founding team members.
Why is this the case? What did you miss here? Explain before making any changes

---

## 8

Okay, so let's do one thing. we'll create the profiles, also we'll give the users the options to create profiles. Once those profiles are created, with every query I can, or let's say with every prompt I can specifically ask it to use a particular profile for me, and that is how it should then judge, like obviously all the subagents, it shouldn't affect their working. The final verdict should now be LLM-based, yes, it should be LLM-based. And pass that profile and then the verdict or the specific score I would say should be based out of that profile. Everything else should still remain the same, everything else, just the score and the verdict based out of you know that.
