import OpenAI from "openai";
import sql from "../configs/db.js";
import { clerkClient } from "@clerk/express";
import axios from "axios";
import {v2 as cloudinary} from "cloudinary";
import fs from 'fs';
// const pdfParse = require('pdf-parse');   // below your other imports

// import pdf from 'pdf-parse/lib/pdf-parse.js';
// import pdf from 'pdf-parse';




const AI = new OpenAI({
    apiKey: process.env.GEMINI_API_KEY,
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/"
});


export const generateArticle = async(req, res) => {
    try{
        const { userId } = req.auth();
        const { prompt, length } = req.body;
        const plan = req.plan;
        const free_usage = req.free_usage;


        if(plan !== 'premium' && free_usage >= 10){
            return res.json({success:false, message:"Limit reached. Upgrade to continue."})
        }

        // Determine word count range based on length parameter
        // length: 800 = Short (500-800 words)
        // length: 1200 = Medium (800-1200 words)  
        // length: 1600 = Long (1200+ words)
        let wordCountRange;
        let minWords, maxWords;
        
        if (length <= 800) {
            minWords = 500;
            maxWords = 800;
            wordCountRange = '500-800 words';
        } else if (length <= 1200) {
            minWords = 800;
            maxWords = 1200;
            wordCountRange = '800-1200 words';
        } else {
            minWords = 1200;
            maxWords = 1600;
            wordCountRange = '1200-1600 words';
        }

        // Optimized token limits for speed while ensuring completeness
        // 1 word ≈ 1.3-1.5 tokens, with buffer for markdown formatting
        let maxTokens;
        if (length <= 800) {
            maxTokens = 2000; // Reduced from 3000 for faster generation
        } else if (length <= 1200) {
            maxTokens = 3000; // Reduced from 4500
        } else {
            maxTokens = 4000; // Reduced from 6000
        }

        // Optimized prompt - shorter and more direct for faster generation
        const enhancedPrompt = `Write a complete article on: ${prompt}

Requirements:
- Word count: ${wordCountRange} (aim for ${Math.round((minWords + maxWords) / 2)} words)
- Include title, introduction, body sections, and conclusion
- Format with markdown (## for headings)
- Complete and well-structured`;

        let content = '';
        let attempts = 0;
        const maxAttempts = 2; // Reduced retries for speed - only retry if cut off

        while (attempts < maxAttempts) {
            const response = await AI.chat.completions.create({
                model: "gemini-2.5-flash",
                messages: [{
                    role: "user",
                    content: enhancedPrompt,
                }],
                temperature: 0.7,
                max_tokens: maxTokens,
            });

            const finishReason = response.choices[0]?.finish_reason;
            content = response.choices[0].message.content || '';

            // Only retry if response was cut off, not for word count
            if (finishReason === 'length' || finishReason === 'max_tokens') {
                console.log(`Response cut off (${finishReason}), retrying with more tokens...`);
                if (attempts < maxAttempts - 1) {
                    maxTokens = Math.min(maxTokens * 1.5, 8192);
                    attempts++;
                    continue;
                }
            } else if (finishReason === 'stop' && content) {
                // Accept the response - word count validation happens after (just for logging)
                break;
            }

            attempts++;
        }

        // Final check - if content seems incomplete, log warning
        if (content && !content.trim().endsWith('.') && !content.trim().endsWith('!') && !content.trim().endsWith('?')) {
            console.warn('Content may be incomplete - does not end with proper punctuation');
        }

        // Ensure we have content
        if (!content || content.trim().length === 0) {
            return res.json({success: false, message: 'Failed to generate article. Please try again.'});
        }

        // Word count validation and logging (informational only - don't block response)
        const wordCount = content.trim().split(/\s+/).filter(word => word.length > 0).length;
        
        // Allow 10% variance for speed - just log, don't retry
        const variance = Math.round(maxWords * 0.1);
        const acceptableMin = minWords - variance;
        const acceptableMax = maxWords + variance;
        
        if (wordCount < acceptableMin) {
            console.log(`Article word count: ${wordCount} (target: ${minWords}-${maxWords}, slightly short but acceptable)`);
        } else if (wordCount > acceptableMax) {
            console.log(`Article word count: ${wordCount} (target: ${minWords}-${maxWords}, slightly long but acceptable)`);
        } else {
            console.log(`Article word count: ${wordCount} (target: ${minWords}-${maxWords}) ✅`);
        }

        await sql`INSERT INTO creations (user_id, prompt, content, type)
        VALUES (${userId}, ${prompt}, ${content}, 'article')
        `;


        if (plan !== 'premium') {
        await clerkClient.users.updateUserMetadata(userId, {
            privateMetadata: {
            free_usage: free_usage + 1
            }
        })
        }


        res.json({ success: true, content });



    }catch(error){
        console.log(error.message)
        res.json({success: false, message: error.message})
    }
}



export const generateBlogTitle = async(req, res) => {
    try{
        const { userId } = req.auth();
        const { prompt } = req.body;
        const plan = req.plan;
        const free_usage = req.free_usage;


        if(plan !== 'premium' && free_usage >= 10){
            return res.json({success:false, message:"Limit reached. Upgrade to continue."})
        }

        // Enhanced prompt to generate multiple complete blog titles
        const enhancedPrompt = `${prompt}

Generate exactly 20 creative, engaging, and SEO-friendly blog title suggestions.

IMPORTANT REQUIREMENTS:
- Format as a simple numbered list: 1. Title here
- Each title on its own line
- Each title should be 50-70 characters
- Make titles compelling and click-worthy
- Relevant to the keyword and category
- You MUST provide all 20 titles from 1 to 20
- Do NOT stop mid-title or cut off the list
- Complete the entire list before finishing`;

        let content = '';
        let attempts = 0;
        const maxAttempts = 3;
        let maxTokens = 2500; // Start with higher limit for 20 titles

        while (attempts < maxAttempts) {
            const response = await AI.chat.completions.create({
                model: "gemini-2.5-flash",
                messages: [{
                    role: "user",
                    content: enhancedPrompt,
                }],
                temperature: 0.8,
                max_tokens: maxTokens,
            });

            const finishReason = response.choices[0]?.finish_reason;
            content = response.choices[0].message.content || '';

            // Check if response was cut off
            if (finishReason === 'length' || finishReason === 'max_tokens') {
                console.log(`Blog titles cut off (${finishReason}), attempt ${attempts + 1}, current tokens: ${maxTokens}`);
                if (attempts < maxAttempts - 1) {
                    // Increase tokens significantly on retry
                    maxTokens = Math.min(maxTokens * 1.8, 8192);
                    attempts++;
                    continue;
                }
            } else if (finishReason === 'stop' && content) {
                // Check if we got a reasonable number of titles (at least 15)
                const titleCount = (content.match(/\d+\./g) || []).length;
                if (titleCount >= 15) {
                    console.log(`Blog titles generated successfully: ${titleCount} titles`);
                    break;
                } else {
                    console.log(`Only ${titleCount} titles generated, retrying...`);
                    if (attempts < maxAttempts - 1) {
                        maxTokens = Math.min(maxTokens * 1.5, 8192);
                        attempts++;
                        continue;
                    }
                }
            }

            attempts++;
        }

        // Ensure we have content
        if (!content || content.trim().length === 0) {
            return res.json({success: false, message: 'Failed to generate blog titles. Please try again.'});
        }

        await sql`INSERT INTO creations (user_id, prompt, content, type)
        VALUES (${userId}, ${prompt}, ${content}, 'blog-title')`;


        if (plan !== 'premium') {
        await clerkClient.users.updateUserMetadata(userId, {
            privateMetadata: {
            free_usage: free_usage + 1
            }
        })
        }


        res.json({ success: true, content });



    }catch(error){
        console.log(error.message)
        res.json({success: false, message: error.message})
    }
}



export const generateImage = async(req, res) => {
    try{
        const { userId } = req.auth();
        const { prompt, publish } = req.body;
        const plan = req.plan;


        if(plan !== 'premium'){
            return res.json({success:false, message:"This feature is only available for premium users."})
        }


        // In Node.js we don't have browser FormData by default. Use a plain object body
        // while keeping the `formData` variable name (used elsewhere in the codebase).
        const formData = { prompt };


        const { data } = await axios.post(
            "https://clipdrop-api.co/text-to-image/v1",
            formData,
            {
                headers: {
                    'x-api-key': process.env.CLIPDROP_API_KEY,
                    'Content-Type': 'application/json'
                },
                responseType: 'arraybuffer',
            }
        );


        const base64Image = `data:image/png;base64,${Buffer.from(data, 'binary').toString('base64')}`;


        const {secure_url} = await cloudinary.uploader.upload(base64Image)
       



        await sql`INSERT INTO creations (user_id, prompt, content, type, publish)
        VALUES (${userId}, ${prompt}, ${secure_url}, 'image', ${publish ?? false})`;


        res.json({ success: true, content : secure_url});



    }catch(error){
        console.log(error.response?.data || error.message || error)
        res.status(500).json({success: false, message: error.response?.data || error.message})
    }
}



export const removeImageBackground = async(req, res) => {
    try{
        const { userId } = req.auth();
        const image  = req.file;
        const plan = req.plan;


        if(plan !== 'premium'){
            return res.json({success:false, message:"This feature is only available for premium users."})
        }


       
        const {secure_url} = await cloudinary.uploader.upload(image.path, {
            transformation: [
                {
                    effect: 'background_removal',
                    background_removal: 'remove_the_background'
                }
            ]
        })
       


        await sql`INSERT INTO creations (user_id, prompt, content, type)
        VALUES (${userId}, 'Remove background from image', ${secure_url}, 'image')`;


        res.json({ success: true, content : secure_url});



    }catch(error){
        console.log(error.message)
        res.json({success: false, message: error.message})
    }
}



export const removeImageObject = async(req, res) => {
    try{
        const { userId } = req.auth();
        const { object } = req.body;
        const  image  = req.file;
        const plan = req.plan;



        if(plan !== 'premium'){
            return res.json({success:false, message:"This feature is only available for premium users."})
        }


       
        const {public_id} = await cloudinary.uploader.upload(image.path)

        // sanitize object name: trim, remove illegal chars and replace spaces
        const sanitized = String(object || '')
          .trim()
          .toLowerCase()
          .replace(/\s+/g, '_')           // replace spaces with underscore
          .replace(/[^a-z0-9_]/g, '')    // remove any other illegal chars

        const effectVal = `gen_remove:${sanitized}` // no extra space after colon

        const imageUrl = cloudinary.url(public_id, {
            transformation: [{ effect: effectVal }],
            resource_type: 'image'
        })

        // debug log
        console.log('remove-image url:', imageUrl, 'effect:', effectVal)



        // const imageUrl = cloudinary.url(public_id, {
        //     transformation: [{effect: `gen_remove: ${object}`}],
        //     resource_type: 'image'
        // })
       


        await sql`INSERT INTO creations (user_id, prompt, content, type)
        VALUES (${userId}, ${`Removed ${object} from image`}, ${imageUrl}, 'image')`;


        res.json({ success: true, content : imageUrl});



    }catch(error){
        console.log(error.message)
        res.json({success: false, message: error.message})
    }
}
