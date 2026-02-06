/*
  Warnings:

  - Added the required column `filename` to the `knowledge_base` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE `knowledge_base` ADD COLUMN `filename` VARCHAR(191) NOT NULL;
